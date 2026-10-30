//! C-ABI Foreign Function Interface for Gateway Phase 3: HTTP Header Filter Phase.
//!
//! Inspects and transforms egress response headers (e.g. response compression,
//! CORS headers, trace headers, security headers) before transmitting headers to the client.

use super::access::AuroraHeader;
use std::panic::catch_unwind;

pub const AURORA_FILTER_PASSTHROUGH: u32 = 0;
pub const AURORA_FILTER_MUTATE: u32 = 1;
pub const AURORA_FILTER_COMPRESS: u32 = 2;

/// Ingress metadata for Phase 3: Header Filter Phase.
#[repr(C)]
pub struct AuroraHeaderFilterInput {
    pub upstream_status: u32,
    pub is_websocket: u32,
    pub path: *const u8,
    pub path_len: usize,
    pub content_type: *const u8,
    pub content_type_len: usize,
    pub content_length: usize,
    pub accept_encoding: *const u8,
    pub accept_encoding_len: usize,
}

/// Outcome of Phase 3: Header Filter Phase.
#[repr(C)]
pub struct AuroraHeaderFilterOutcome {
    pub action: u32,
    pub override_status: u32,
    pub headers_count: u32,
    pub headers: [AuroraHeader; 8],
    pub compression_algorithm: u32,
    pub content_encoding_str: *const u8,
    pub content_encoding_len: usize,
}

impl Default for AuroraHeaderFilterOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_FILTER_PASSTHROUGH,
            override_status: 0,
            headers_count: 0,
            headers: [AuroraHeader::default(); 8],
            compression_algorithm: 0,
            content_encoding_str: std::ptr::null(),
            content_encoding_len: 0,
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
        let mut outcome = AuroraHeaderFilterOutcome::default();
        let input_ref = unsafe { &*input };

        if input_ref.is_websocket == 0
            && let Some(space) = crate::lifecycle::get_active_space()
            && let Some(engine) = &space.response_compression
        {
            let path = if input_ref.path_len > 0 && !input_ref.path.is_null() {
                unsafe {
                    std::str::from_utf8_unchecked(std::slice::from_raw_parts(
                        input_ref.path,
                        input_ref.path_len,
                    ))
                }
            } else {
                "/"
            };
            let route_mask = space.resolve_route_mask(path.as_bytes());
            if (route_mask & (1 << crate::lifecycle::AURORA_EXT_RESPONSE_COMPRESSION)) == 0 {
                unsafe { *out_outcome = outcome };
                return;
            }
            let content_type = if input_ref.content_type_len > 0 && !input_ref.content_type.is_null() {
                unsafe {
                    std::str::from_utf8_unchecked(std::slice::from_raw_parts(
                        input_ref.content_type,
                        input_ref.content_type_len,
                    ))
                }
            } else {
                ""
            };
            let accept_encoding = if input_ref.accept_encoding_len > 0 && !input_ref.accept_encoding.is_null() {
                unsafe {
                    std::str::from_utf8_unchecked(std::slice::from_raw_parts(
                        input_ref.accept_encoding,
                        input_ref.accept_encoding_len,
                    ))
                }
            } else {
                ""
            };

            let dec = engine.evaluate_header(
                path,
                input_ref.upstream_status,
                content_type,
                input_ref.content_length,
                accept_encoding,
            );

            if dec.action == aurora_extensions::response_compression::HeaderDecisionAction::Compress {
                outcome.action = AURORA_FILTER_COMPRESS;
                outcome.compression_algorithm = dec.algorithm as u32;
                let enc_bytes = dec.content_encoding.as_bytes();
                outcome.content_encoding_str = enc_bytes.as_ptr();
                outcome.content_encoding_len = enc_bytes.len();
            }
        }

        unsafe { *out_outcome = outcome };
    });

    0
}
