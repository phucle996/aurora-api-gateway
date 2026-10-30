//! L1 Cacheline Memory Topology & Upstream Slot Sheet
//!
//! Enforces 64-byte hardware cacheline alignment (`#[repr(C, align(64))]`) so all
//! upstream metadata and precompiled headers reside in a single L1 data cacheline.

use std::sync::Arc;
use serde::{Deserialize, Serialize};
use super::swar::{SLOT_BLUE, SLOT_GREEN};

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeploySlot {
    #[default]
    Blue = 0,
    Green = 1,
}

pub const SLOT_NAMES: [&str; 2] = ["blue", "green"];

impl DeploySlot {
    #[inline(always)]
    pub const fn as_str(&self) -> &'static str {
        match self {
            DeploySlot::Blue => "blue",
            DeploySlot::Green => "green",
        }
    }

    #[inline(always)]
    pub const fn to_u8(&self) -> u8 {
        match self {
            DeploySlot::Blue => SLOT_BLUE,
            DeploySlot::Green => SLOT_GREEN,
        }
    }

    #[inline(always)]
    pub const fn from_u8(slot: u8) -> &'static str {
        match slot {
            SLOT_GREEN => "green",
            _ => "blue",
        }
    }

    pub fn from_str_ignore_case(s: &str) -> Option<Self> {
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("blue") {
            Some(DeploySlot::Blue)
        } else if trimmed.eq_ignore_ascii_case("green") {
            Some(DeploySlot::Green)
        } else {
            None
        }
    }
}

/// Metadata and precompiled headers for a single deployment slot (exactly 32 bytes).
/// 2 slots = 64 bytes, perfectly fitting inside a single 64-byte L1 CPU cacheline.
#[repr(C)]
#[derive(Clone, Debug)]
pub struct SlotUpstreamMeta {
    pub upstream: Arc<str>,
    pub headers: Arc<[(String, String)]>,
}

/// Contiguous 64-byte aligned slot sheet: [0] = Blue, [1] = Green.
/// Resides 100% in a single L1 data cacheline with 0 boundary crossings.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct SlotSheet {
    pub upstreams: [SlotUpstreamMeta; 2],
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_sheet_cacheline_size() {
        assert_eq!(std::mem::size_of::<SlotUpstreamMeta>(), 32);
        assert_eq!(std::mem::size_of::<SlotSheet>(), 64);
        assert_eq!(std::mem::align_of::<SlotSheet>(), 64);
    }
}
