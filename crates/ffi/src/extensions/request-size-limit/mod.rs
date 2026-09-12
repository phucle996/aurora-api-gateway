//! Foreign Function Interface (C ABI) for Request Size Limit.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process request size limit engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use crate::extensions::connection_limit::AuroraHeaderLookupFn;
use aurora_engine::request_size_limit::{RequestSizeEvalRequest, RequestSizeLimitEngine};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraRequestSizeDecision {
    pub allowed: u32,
    pub status_code: u16,
    pub matched: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub body_len: u32,
    pub body: [u8; 4096],
}

impl Default for AuroraRequestSizeDecision {
    fn default() -> Self {
        Self {
            allowed: 1,
            status_code: 0,
            matched: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
            body_len: 0,
            body: [0u8; 4096],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_request_size_limit_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_size_limit_create(
    data: *const u8,
    len: usize,
    out: *mut *mut RequestSizeLimitEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        RequestSizeLimitEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
    })) {
        Ok(Ok(engine)) => {
            unsafe { *out = Box::into_raw(Box::new(engine)) };
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}

/// # Safety
/// The handle must be a live engine returned by `aurora_request_size_limit_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_size_limit_destroy(engine: *mut RequestSizeLimitEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured request size limit rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_size_limit_evaluate(
    engine: *const RequestSizeLimitEngine,
    origin: *const u8,
    origin_len: usize,
    path: *const u8,
    path_len: usize,
    client_ip: *const u8,
    client_ip_len: usize,
    header_bytes: u64,
    body_bytes: u64,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraRequestSizeDecision,
) -> u32 {
    if engine.is_null()
        || out_decision.is_null()
        || origin.is_null()
        || origin_len == 0
        || origin_len > 253
        || path.is_null()
        || path_len == 0
        || path_len > 8_192
        || client_ip.is_null()
        || client_ip_len == 0
        || client_ip_len > 64
    {
        return 1;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let origin_slice = unsafe { slice::from_raw_parts(origin, origin_len) };
        let path_slice = unsafe { slice::from_raw_parts(path, path_len) };
        let ip_slice = unsafe { slice::from_raw_parts(client_ip, client_ip_len) };

        let header_lookup = |name: &str| -> Option<&[u8]> {
            let f = lookup_fn?;
            let mut val_ptr: *const u8 = ptr::null();
            let mut val_len: usize = 0;
            let rc = unsafe {
                f(
                    lookup_ctx,
                    name.as_ptr(),
                    name.len(),
                    &mut val_ptr,
                    &mut val_len,
                )
            };
            if rc == 0 && !val_ptr.is_null() && val_len > 0 {
                Some(unsafe { slice::from_raw_parts(val_ptr, val_len) })
            } else {
                None
            }
        };

        let req = RequestSizeEvalRequest {
            origin: origin_slice,
            path: path_slice,
            client_ip: ip_slice,
            header_bytes,
            body_bytes,
        };

        let eng = unsafe { &*engine };
        let decision = eng.evaluate(&req, header_lookup);

        let mut out = AuroraRequestSizeDecision {
            allowed: if decision.allowed { 1 } else { 0 },
            status_code: decision.rejected_code,
            matched: if decision.matched { 1 } else { 0 },
            rule_id_len: 0,
            rule_id: [0u8; 128],
            body_len: 0,
            body: [0u8; 4096],
        };

        let id_bytes = decision.rule_id.as_bytes();
        let copy_id_len = id_bytes.len().min(128);
        out.rule_id[..copy_id_len].copy_from_slice(&id_bytes[..copy_id_len]);
        out.rule_id_len = copy_id_len as u32;

        let copy_body_len = decision.response_body.len().min(4096);
        out.body[..copy_body_len].copy_from_slice(&decision.response_body[..copy_body_len]);
        out.body_len = copy_body_len as u32;

        unsafe { *out_decision = out };
    })) {
        Ok(()) => 0,
        Err(_) => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe extern "C" fn mock_header_lookup(
        ctx: *mut std::ffi::c_void,
        name: *const u8,
        name_len: usize,
        out_val: *mut *const u8,
        out_val_len: *mut usize,
    ) -> u32 {
        let _ = ctx;
        let name_slice = unsafe { slice::from_raw_parts(name, name_len) };
        if name_slice == b"x-role" {
            static VAL: &[u8] = b"vip";
            unsafe {
                *out_val = VAL.as_ptr();
                *out_val_len = VAL.len();
            }
            0
        } else {
            1
        }
    }

    #[test]
    fn test_request_size_limit_c_abi_lifecycle_and_eval() {
        let json = br#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "vip-rule",
                    "priority": 10,
                    "origin": "*",
                    "path_prefix": "/upload",
                    "limit_by": "header",
                    "header_name": "x-role",
                    "match_value": "^(vip|admin)$",
                    "max_request_bytes": 10485760,
                    "max_header_bytes": 32768,
                    "max_body_bytes": 10485760,
                    "rejected_code": 413,
                    "response_body": "{\"error\":\"vip_limit_exceeded\"}"
                },
                {
                    "id": "default-rule",
                    "priority": 20,
                    "origin": "*",
                    "path_prefix": "/upload",
                    "limit_by": "client_ip",
                    "match_value": "*",
                    "max_request_bytes": 102400,
                    "max_header_bytes": 8192,
                    "max_body_bytes": 102400,
                    "rejected_code": 413,
                    "response_body": "{\"error\":\"payload_too_large\"}"
                }
            ]
        }"#;

        unsafe {
            let mut engine: *mut RequestSizeLimitEngine = ptr::null_mut();
            let rc = aurora_request_size_limit_create(json.as_ptr(), json.len(), &mut engine);
            assert_eq!(rc, 0);
            assert!(!engine.is_null());

            let mut decision = AuroraRequestSizeDecision::default();

            let origin = b"api.example.com";
            let path = b"/upload/file";
            let client_ip = b"192.168.1.10";

            // 1. VIP request under limit (1MB < 10MB) -> allowed
            let eval_rc = aurora_request_size_limit_evaluate(
                engine,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                client_ip.as_ptr(),
                client_ip.len(),
                500,
                1_000_000,
                ptr::null_mut(),
                Some(mock_header_lookup),
                &mut decision,
            );
            assert_eq!(eval_rc, 0);
            assert_eq!(decision.allowed, 1);
            assert_eq!(decision.matched, 1);
            assert_eq!(
                &decision.rule_id[..decision.rule_id_len as usize],
                b"vip-rule"
            );

            // 2. Non-VIP request (no header lookup) with 500KB (> 100KB default limit) -> rejected with custom body
            let eval_rc2 = aurora_request_size_limit_evaluate(
                engine,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                client_ip.as_ptr(),
                client_ip.len(),
                500,
                500_000,
                ptr::null_mut(),
                None,
                &mut decision,
            );
            assert_eq!(eval_rc2, 0);
            assert_eq!(decision.allowed, 0);
            assert_eq!(decision.matched, 1);
            assert_eq!(decision.status_code, 413);
            assert_eq!(
                &decision.rule_id[..decision.rule_id_len as usize],
                b"default-rule"
            );
            assert_eq!(
                &decision.body[..decision.body_len as usize],
                b"{\"error\":\"payload_too_large\"}"
            );

            aurora_request_size_limit_destroy(engine);
        }
    }
}
