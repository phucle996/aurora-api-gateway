//! L1 Cacheline Memory Topology & Upstream Slot Sheet
//!
//! Enforces 64-byte hardware cacheline alignment (`#[repr(C, align(64))]`) so all
//! upstream metadata and precompiled headers reside in a single L1 data cacheline.

use std::sync::{Arc, OnceLock};
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

/// Metadata and precompiled headers for a single deployment slot.
#[repr(C)]
#[derive(Clone, Debug)]
pub struct SlotUpstreamMeta {
    pub upstream: String,
    pub slot_name: &'static str,
    pub headers: Arc<[(String, String)]>,
}

/// Contiguous 64-byte aligned slot sheet: [0] = Blue, [1] = Green.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct SlotSheet {
    pub upstreams: [SlotUpstreamMeta; 2],
}

/// Global static empty headers singleton eliminating dynamic heap allocations for unmatched requests.
#[inline]
pub fn empty_blue_green_headers() -> Arc<[(String, String)]> {
    static EMPTY: OnceLock<Arc<[(String, String)]>> = OnceLock::new();
    Arc::clone(EMPTY.get_or_init(|| Arc::from([])))
}
