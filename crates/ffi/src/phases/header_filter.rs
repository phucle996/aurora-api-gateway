//! C-ABI Foreign Function Interface for Gateway Phase 3: HTTP Header Filter Phase.
//!
//! Inspects and transforms egress response headers (e.g. CORS headers,
//! trace headers, security headers) before transmitting headers to the client.

use super::access::AuroraHeader;
use std::panic::catch_unwind;

pub const AURORA_FILTER_PASSTHROUGH: u32 = 0;
pub const AURORA_FILTER_MUTATE: u32 = 1;

/// Ingress metadata for Phase 3: Header Filter Phase.
#[repr(C)]
pub struct AuroraHeaderFilterInput {
    pub upstream_status: u32,
    pub is_websocket: u32,
}

/// Outcome of Phase 3: Header Filter Phase.
#[repr(C)]
pub struct AuroraHeaderFilterOutcome {
    pub action: u32,
    pub override_status: u32,
    pub headers_count: u32,
    pub headers: [AuroraHeader; 8],
}

impl Default for AuroraHeaderFilterOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_FILTER_PASSTHROUGH,
            override_status: 0,
            headers_count: 0,
            headers: [AuroraHeader::default(); 8],
        }
    }
}

/// Executes Gateway Phase 3: Header Filter Phase.
///
/// # Safety
/// `input` and `out_outcome` must point to valid initialized structs.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_phase_header_filter(
    input: *const AuroraHeaderFilterInput,
    out_outcome: *mut AuroraHeaderFilterOutcome,
) -> u32 {
    if out_outcome.is_null() {
        return 1;
    }

    if input.is_null() {
        unsafe { *out_outcome = AuroraHeaderFilterOutcome::default() };
        return 0;
    }

    let _ = catch_unwind(move || {
        let outcome = AuroraHeaderFilterOutcome {
            action: AURORA_FILTER_PASSTHROUGH,
            ..Default::default()
        };
        unsafe { *out_outcome = outcome };
    });

    0
}
