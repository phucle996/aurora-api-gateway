//! C-ABI Foreign Function Interface for Gateway Phase 4: HTTP Body Filter Phase.
//!
//! Inspects and streams egress response body chunks before delivering to the client.

use aurora_extensions::response_compression::CompressionAlgorithm;
use super::access::AuroraAllocFn;
use std::panic::catch_unwind;

pub const AURORA_BODY_FILTER_PASSTHROUGH: u32 = 0;
pub const AURORA_BODY_FILTER_MUTATED: u32 = 1;

/// Chunk data metadata for Phase 4: Body Filter Phase.
#[repr(C)]
pub struct AuroraBodyFilterInput {
    pub chunk: *const u8,
    pub chunk_len: usize,
    pub is_last: u32,
    pub compression_algorithm: u32,
    pub alloc_ctx: *mut std::ffi::c_void,
    pub alloc_fn: Option<AuroraAllocFn>,
}

/// Outcome of Phase 4: Body Filter Phase.
#[repr(C)]
pub struct AuroraBodyFilterOutcome {
    pub action: u32,
    pub out_ptr: *mut u8,
    pub out_len: usize,
}

impl Default for AuroraBodyFilterOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_BODY_FILTER_PASSTHROUGH,
            out_ptr: std::ptr::null_mut(),
            out_len: 0,
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
        let input_ref = unsafe { &*input };
        let mut outcome = AuroraBodyFilterOutcome::default();

        if input_ref.compression_algorithm != 0
            && input_ref.is_last != 0
            && input_ref.chunk_len > 0
            && let Some(space) = crate::lifecycle::get_active_space()
            && let Some(engine) = &space.response_compression
            && let Some(alloc_fn) = input_ref.alloc_fn
        {
            let algo = match input_ref.compression_algorithm {
                1 => CompressionAlgorithm::Zstd,
                2 => CompressionAlgorithm::Brotli,
                3 => CompressionAlgorithm::Gzip,
                _ => CompressionAlgorithm::None,
            };

            if algo != CompressionAlgorithm::None
                && let Ok((ptr, len)) = unsafe {
                    engine.compress_single_shot(
                        algo,
                        input_ref.chunk,
                        input_ref.chunk_len,
                        input_ref.alloc_ctx,
                        alloc_fn,
                    )
                }
            {
                outcome.action = AURORA_BODY_FILTER_MUTATED;
                outcome.out_ptr = ptr;
                outcome.out_len = len;
            }
        }

        unsafe { *out_outcome = outcome };
    });

    0
}
