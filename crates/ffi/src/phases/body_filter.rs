//! C-ABI Foreign Function Interface for Gateway Phase 4: HTTP Body Filter Phase.
//!
//! Inspects and streams egress response body chunks before delivering to the client.

use std::panic::catch_unwind;

pub const AURORA_BODY_FILTER_PASSTHROUGH: u32 = 0;

/// Chunk data metadata for Phase 4: Body Filter Phase.
#[repr(C)]
pub struct AuroraBodyFilterInput {
    pub chunk: *const u8,
    pub chunk_len: usize,
    pub is_last: u32,
}

/// Outcome of Phase 4: Body Filter Phase.
#[repr(C)]
pub struct AuroraBodyFilterOutcome {
    pub action: u32,
}

impl Default for AuroraBodyFilterOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_BODY_FILTER_PASSTHROUGH,
        }
    }
}

/// Executes Gateway Phase 4: Body Filter Phase.
///
/// # Safety
/// `input` and `out_outcome` must point to valid memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_phase_body_filter(
    input: *const AuroraBodyFilterInput,
    out_outcome: *mut AuroraBodyFilterOutcome,
) -> u32 {
    if out_outcome.is_null() {
        return 1;
    }

    if input.is_null() {
        unsafe { *out_outcome = AuroraBodyFilterOutcome::default() };
        return 0;
    }

    let _ = catch_unwind(move || {
        let outcome = AuroraBodyFilterOutcome {
            action: AURORA_BODY_FILTER_PASSTHROUGH,
        };
        unsafe { *out_outcome = outcome };
    });

    0
}
