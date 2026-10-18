//! Policy Shared Memory (SHM) Substrate
//!
//! Provides a lockless, zero-copy shared memory substrate between Aurora Agent
//! and NGINX worker processes for in-memory dynamic policy hot-swapping.
//!
//! Ensures zero disk I/O for policy updates, zero NGINX reload disruptions,
//! and strictly decoupled control plane updates from the request data plane (hot-path).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub const POLICY_MAGIC: u32 = 0x504F4C59; // "POLY"
pub const POLICY_VERSION: u32 = 1;
pub const POLICY_SHM_DEFAULT_PATH: &str = "/dev/shm/aurora_gateway_policy.bin";

pub const AURORA_EXT_IP_RESTRICTION: u32 = 0;
pub const AURORA_EXT_JWT: u32 = 1;
pub const AURORA_EXT_RATE_LIMIT: u32 = 2;
pub const AURORA_EXT_CONN_LIMIT: u32 = 3;
pub const AURORA_EXT_TRAFFIC_SHAPER: u32 = 4;
pub const AURORA_EXT_REQUEST_SIZE_LIMIT: u32 = 5;
pub const AURORA_EXT_TRAFFIC_SPLIT: u32 = 6;
pub const AURORA_EXT_CANARY_RELEASE: u32 = 7;
pub const AURORA_EXT_BLUE_GREEN: u32 = 8;
pub const AURORA_EXT_REQUEST_MIRROR: u32 = 9;
pub const AURORA_EXT_REQUEST_TERMINATION: u32 = 10;
pub const AURORA_EXT_COUNT: usize = 11;
pub const POLICY_MAX_SLOTS: usize = 16;

pub const POLICY_HEADER_SIZE: usize = 4096;
pub const POLICY_SLOT_TOTAL_SIZE: usize = 65536;
pub const POLICY_SLOT_META_SIZE: usize = 64;
pub const POLICY_SLOT_CAPACITY: usize = POLICY_SLOT_TOTAL_SIZE - POLICY_SLOT_META_SIZE; // 65,472 bytes
pub const POLICY_SHM_TOTAL_BYTES: usize =
    POLICY_HEADER_SIZE + (POLICY_MAX_SLOTS * POLICY_SLOT_TOTAL_SIZE); // 1,052,672 bytes

/// Single Extension Policy Slot inside SHM.
#[repr(C)]
pub struct PolicySlot {
    pub extension_id: u32,
    pub checksum: u32,
    pub generation: AtomicU64,
    pub updated_at_unix_ms: u64,
    pub data_len: AtomicU32,
    pub reserved: [u8; 36],
    pub data: [u8; POLICY_SLOT_CAPACITY],
}

impl PolicySlot {
    pub const fn new(id: u32) -> Self {
        Self {
            extension_id: id,
            checksum: 0,
            generation: AtomicU64::new(0),
            updated_at_unix_ms: 0,
            data_len: AtomicU32::new(0),
            reserved: [0u8; 36],
            data: [0u8; POLICY_SLOT_CAPACITY],
        }
    }
}

/// Global Policy SHM Region Header.
#[repr(C)]
pub struct PolicyShmHeader {
    pub magic: u32,
    pub version: u32,
    pub total_generation: AtomicU64,
    pub slots_count: u32,
    pub reserved: [u8; POLICY_HEADER_SIZE - 24],
    pub slots: [PolicySlot; POLICY_MAX_SLOTS],
}

impl Default for PolicyShmHeader {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyShmHeader {
    /// Constructs a clean `PolicyShmHeader` with default slot IDs and zeroed generations.
    pub const fn new() -> Self {
        Self {
            magic: POLICY_MAGIC,
            version: POLICY_VERSION,
            total_generation: AtomicU64::new(0),
            slots_count: POLICY_MAX_SLOTS as u32,
            reserved: [0u8; POLICY_HEADER_SIZE - 24],
            slots: [
                PolicySlot::new(0),
                PolicySlot::new(1),
                PolicySlot::new(2),
                PolicySlot::new(3),
                PolicySlot::new(4),
                PolicySlot::new(5),
                PolicySlot::new(6),
                PolicySlot::new(7),
                PolicySlot::new(8),
                PolicySlot::new(9),
                PolicySlot::new(10),
                PolicySlot::new(11),
                PolicySlot::new(12),
                PolicySlot::new(13),
                PolicySlot::new(14),
                PolicySlot::new(15),
            ],
        }
    }

    /// Verifies magic and version, initializing if brand new memory.
    pub fn ensure_header(&mut self) {
        if self.magic != POLICY_MAGIC || self.version != POLICY_VERSION {
            self.magic = POLICY_MAGIC;
            self.version = POLICY_VERSION;
            self.total_generation.store(0, Ordering::Relaxed);
            self.slots_count = POLICY_MAX_SLOTS as u32;
            for (idx, slot) in self.slots.iter_mut().enumerate() {
                slot.extension_id = idx as u32;
                slot.generation.store(0, Ordering::Relaxed);
                slot.data_len.store(0, Ordering::Relaxed);
                slot.checksum = 0;
                slot.updated_at_unix_ms = 0;
            }
        }
    }

    /// Update a specific slot with JSON policy bytes.
    /// Returns true if updated successfully, false if payload exceeds slot capacity.
    pub fn update_slot(
        &mut self,
        slot_id: u32,
        generation: u64,
        payload: Option<&[u8]>,
    ) -> bool {
        let idx = slot_id as usize;
        if idx >= POLICY_MAX_SLOTS {
            return false;
        }

        let slot = &mut self.slots[idx];
        if let Some(bytes) = payload {
            if bytes.len() > POLICY_SLOT_CAPACITY {
                return false;
            }
            slot.data[..bytes.len()].copy_from_slice(bytes);
            let csum = compute_crc32(bytes);
            slot.checksum = csum;
            slot.data_len.store(bytes.len() as u32, Ordering::Release);
        } else {
            slot.data_len.store(0, Ordering::Release);
            slot.checksum = 0;
        }

        slot.generation.store(generation, Ordering::Release);
        self.total_generation.fetch_add(1, Ordering::Release);
        true
    }

    /// Read data from a specific slot.
    pub fn read_slot(&self, slot_id: u32) -> Option<(u64, &[u8])> {
        let idx = slot_id as usize;
        if idx >= POLICY_MAX_SLOTS {
            return None;
        }

        let slot = &self.slots[idx];
        let generation = slot.generation.load(Ordering::Acquire);
        let len = slot.data_len.load(Ordering::Acquire) as usize;
        if len == 0 || len > POLICY_SLOT_CAPACITY {
            return Some((generation, &[]));
        }

        let data = &slot.data[..len];
        if compute_crc32(data) != slot.checksum {
            // Torn write or corrupted data, reject
            return None;
        }

        Some((generation, data))
    }

    /// Read the global total generation counter.
    #[inline(always)]
    pub fn get_total_generation(&self) -> u64 {
        self.total_generation.load(Ordering::Acquire)
    }
}

/// Simple CRC32 implementation to avoid external crate dependencies in engine SHM.
fn compute_crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_shm_layout_and_alignment() {
        assert_eq!(std::mem::size_of::<PolicySlot>(), POLICY_SLOT_TOTAL_SIZE);
        assert_eq!(
            std::mem::size_of::<PolicyShmHeader>(),
            POLICY_SHM_TOTAL_BYTES
        );
        assert_eq!(POLICY_SHM_TOTAL_BYTES % 4096, 0);
    }

    #[test]
    fn test_policy_slot_update_and_read() {
        let mut raw = vec![0u8; POLICY_SHM_TOTAL_BYTES];
        let header = unsafe { &mut *(raw.as_mut_ptr() as *mut PolicyShmHeader) };
        header.ensure_header();

        let json = br#"{"rules":[{"id":"test","action":"allow"}]}"#;
        assert!(header.update_slot(AURORA_EXT_IP_RESTRICTION, 101, Some(json)));
        assert_eq!(header.get_total_generation(), 1);

        let (slot_gen, data) = header.read_slot(AURORA_EXT_IP_RESTRICTION).unwrap();
        assert_eq!(slot_gen, 101);
        assert_eq!(data, json);

        // Clear slot
        assert!(header.update_slot(AURORA_EXT_IP_RESTRICTION, 102, None));
        assert_eq!(header.get_total_generation(), 2);

        let (slot_gen2, data2) = header.read_slot(AURORA_EXT_IP_RESTRICTION).unwrap();
        assert_eq!(slot_gen2, 102);
        assert!(data2.is_empty());
    }
}
