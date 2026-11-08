#!/usr/bin/env python3
"""
Applies, configures, or disables Connection Limit policy (Slot 3) directly into Dataplane SHM.
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

AURORA_EXT_CONN_LIMIT = 3
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

def apply_conn_limit_policy(mode="allow"):
    with open(SHM_PATH, "r+b") as f:
        mm = mmap.mmap(f.fileno(), 0)
        now_gen = int(time.time())

        if mode == "disable":
            update_slot(mm, AURORA_EXT_CONN_LIMIT, now_gen, b"")
            update_slot(mm, AURORA_SLOT_ROUTE_MASKS, now_gen, b"")
            struct.pack_into("<Q", mm, 8, now_gen)
            mm.flush()
            print("Connection Limit & RouteMasks disabled.")
            return

        if mode == "saturate":
            # Cap concurrent connections to 20 to test 503 rejection under 200 concurrent connections
            max_conn = 20
        elif mode == "allow":
            # High concurrency headroom (500 conns) -> zero throttling
            max_conn = 500
        else:
            try:
                max_conn = int(mode)
            except ValueError:
                max_conn = 500

        policy = {
            "schema_version": 1,
            "generation": now_gen,
            "mode": "local",
            "rules": [
                {
                    "id": "bench-conn-limit",
                    "priority": 1,
                    "host": "*",
                    "path_prefix": "/api/v1",
                    "limit_by": "client_ip",
                    "max_connections": max_conn,
                    "action_on_exceeded": "throttle",
                    "rejected_code": 503
                }
            ]
        }

        route_masks = {
            "routes": [
                {
                    "path": "/api/v1",
                    "allow_mask": (1 << AURORA_EXT_CONN_LIMIT),
                    "deny_mask": 0,
                    "explicit": True
                }
            ]
        }

        conn_bytes = json.dumps(policy).encode("utf-8")
        masks_bytes = json.dumps(route_masks).encode("utf-8")

        update_slot(mm, AURORA_EXT_CONN_LIMIT, now_gen, conn_bytes)
        update_slot(mm, AURORA_SLOT_ROUTE_MASKS, now_gen, masks_bytes)

        # Update global generation
        struct.pack_into("<Q", mm, 8, now_gen)
        mm.flush()
        print(f"Applied Connection Limit policy [max_connections={max_conn}, gen={now_gen}] successfully.")

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "allow"
    apply_conn_limit_policy(mode)
