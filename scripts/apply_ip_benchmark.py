#!/usr/bin/env python3
"""
Applies or disables IP restriction policy (Slot 0) directly into Dataplane SHM.
"""
import sys
import mmap
import struct
import time
import json
import zlib

SHM_PATH = "/dev/shm/aurora_gateway_policy.bin"
HEADER_SIZE = 4096
SLOT_TOTAL_SIZE = 65536
SLOT_META_SIZE = 64
SLOT_CAPACITY = SLOT_TOTAL_SIZE - SLOT_META_SIZE

AURORA_EXT_IP_RESTRICTION = 0
AURORA_SLOT_ROUTE_MASKS = 15

def update_slot(mm, slot_id, gen, data_bytes):
    slot_offset = HEADER_SIZE + slot_id * SLOT_TOTAL_SIZE
    data_len = len(data_bytes)
    assert data_len <= SLOT_CAPACITY, f"Data len {data_len} > {SLOT_CAPACITY}"
    crc = zlib.crc32(data_bytes)
    now_ms = int(time.time() * 1000)

    # 1. Invalidate slot generation
    struct.pack_into("<Q", mm, slot_offset + 8, 0)
    # 2. Write payload
    mm[slot_offset + SLOT_META_SIZE : slot_offset + SLOT_META_SIZE + data_len] = data_bytes
    # 3. Write metadata: ext_id(u32), crc(u32), gen=0, updated_ms(u64), data_len(u32)
    struct.pack_into("<II", mm, slot_offset, slot_id, crc)
    struct.pack_into("<Q", mm, slot_offset + 16, now_ms)
    struct.pack_into("<I", mm, slot_offset + 24, data_len)
    # 4. Atomic release generation
    struct.pack_into("<Q", mm, slot_offset + 8, gen)

def apply_ip_policy(mode="allow"):
    with open(SHM_PATH, "r+b") as f:
        mm = mmap.mmap(f.fileno(), 0)
        now_gen = int(time.time())

        if mode == "disable":
            update_slot(mm, AURORA_EXT_IP_RESTRICTION, now_gen, b"")
            update_slot(mm, AURORA_SLOT_ROUTE_MASKS, now_gen, b"")
            struct.pack_into("<Q", mm, 8, now_gen)
            mm.flush()
            print("IP Restriction & RouteMasks disabled.")
            return

        if mode == "block":
            # Block client IP from VM2 (172.16.0.5)
            policy = {
                "schema_version": 1,
                "generation": now_gen,
                "whitelist": [],
                "blacklist": ["172.16.0.5/32"],
                "rules": []
            }
        elif mode == "multitier":
            # Multi-tier subnet matching
            policy = {
                "schema_version": 1,
                "generation": now_gen,
                "whitelist": [],
                "blacklist": [],
                "rules": [
                    {
                        "id": 1,
                        "priority": 10,
                        "action": "allow",
                        "networks": ["172.16.0.0/16"],
                        "path_prefix": "/api/v1",
                        "host": "*",
                        "method": "GET"
                    },
                    {
                        "id": 2,
                        "priority": 20,
                        "action": "block",
                        "networks": ["0.0.0.0/0"],
                        "path_prefix": "/api/v1",
                        "host": "*",
                        "method": "*"
                    }
                ]
            }
        else: # "allow"
            # Whitelist subnet covering VM2 (172.16.0.0/16)
            policy = {
                "schema_version": 1,
                "generation": now_gen,
                "whitelist": ["172.16.0.0/16"],
                "blacklist": [],
                "rules": []
            }

        route_masks = {
            "routes": [
                {
                    "path": "/api/v1",
                    "allow_mask": (1 << AURORA_EXT_IP_RESTRICTION),
                    "deny_mask": 0,
                    "explicit": True
                }
            ]
        }

        ip_bytes = json.dumps(policy).encode("utf-8")
        masks_bytes = json.dumps(route_masks).encode("utf-8")

        update_slot(mm, AURORA_EXT_IP_RESTRICTION, now_gen, ip_bytes)
        update_slot(mm, AURORA_SLOT_ROUTE_MASKS, now_gen, masks_bytes)

        # Update global generation
        struct.pack_into("<Q", mm, 8, now_gen)
        mm.flush()
        print(f"Applied IP restriction policy [mode={mode}, gen={now_gen}] successfully.")

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "allow"
    apply_ip_policy(mode)
