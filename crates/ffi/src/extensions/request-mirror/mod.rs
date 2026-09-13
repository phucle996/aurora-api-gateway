//! Foreign Function Interface (C ABI) for Request Mirror.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process request-mirror engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use aurora_engine::request_mirror::{RequestMirrorEngine, RequestMirrorEvalRequest};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraUpstreamHeader {
    pub name_len: u32,
    pub name: [u8; 64],
    pub value_len: u32,
    pub value: [u8; 256],
}

impl Default for AuroraUpstreamHeader {
    fn default() -> Self {
        Self {
            name_len: 0,
            name: [0u8; 64],
            value_len: 0,
            value: [0u8; 256],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraMirrorDecision {
    pub matched: u32,
    pub is_mirrored: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub primary_upstream_len: u32,
    pub primary_upstream: [u8; 128],
    pub mirror_upstream_len: u32,
    pub mirror_upstream: [u8; 128],
    pub headers_count: u32,
    pub headers: [AuroraUpstreamHeader; 16],
}

impl Default for AuroraMirrorDecision {
    fn default() -> Self {
        Self {
            matched: 0,
            is_mirrored: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
            primary_upstream_len: 0,
            primary_upstream: [0u8; 128],
            mirror_upstream_len: 0,
            mirror_upstream: [0u8; 128],
            headers_count: 0,
            headers: [AuroraUpstreamHeader::default(); 16],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_request_mirror_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_mirror_create(
    data: *const u8,
    len: usize,
    out: *mut *mut RequestMirrorEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        RequestMirrorEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_request_mirror_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_mirror_destroy(engine: *mut RequestMirrorEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured request mirror rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_mirror_evaluate(
    engine: *const RequestMirrorEngine,
    origin: *const u8,
    origin_len: usize,
    path: *const u8,
    path_len: usize,
    method: *const u8,
    method_len: usize,
    random_seed: u32,
    out_decision: *mut AuroraMirrorDecision,
) -> u32 {
    if engine.is_null()
        || out_decision.is_null()
        || origin.is_null()
        || origin_len == 0
        || origin_len > 253
        || path.is_null()
        || path_len == 0
        || path_len > 8_192
        || method.is_null()
        || method_len == 0
        || method_len > 16
    {
        return 1;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let origin_slice = unsafe { slice::from_raw_parts(origin, origin_len) };
        let path_slice = unsafe { slice::from_raw_parts(path, path_len) };
        let method_slice = unsafe { slice::from_raw_parts(method, method_len) };

        let req = RequestMirrorEvalRequest {
            host: origin_slice,
            path: path_slice,
            method: method_slice,
            random_seed,
        };

        let eng = unsafe { &*engine };
        let decision = eng.evaluate(&req);

        let mut out = AuroraMirrorDecision::default();
        if decision.matched {
            out.matched = 1;
            out.is_mirrored = if decision.is_mirrored { 1 } else { 0 };

            let rid = decision.rule_id.as_bytes();
            let rid_len = rid.len().min(128);
            out.rule_id[..rid_len].copy_from_slice(&rid[..rid_len]);
            out.rule_id_len = rid_len as u32;

            let p_up = decision.primary_upstream.as_bytes();
            let p_len = p_up.len().min(128);
            out.primary_upstream[..p_len].copy_from_slice(&p_up[..p_len]);
            out.primary_upstream_len = p_len as u32;

            let m_up = decision.mirror_upstream.as_bytes();
            let m_len = m_up.len().min(128);
            out.mirror_upstream[..m_len].copy_from_slice(&m_up[..m_len]);
            out.mirror_upstream_len = m_len as u32;

            let mut h_idx = 0;
            for (h_name, h_val) in decision.mirror_headers.iter().take(16) {
                let name_bytes = h_name.as_bytes();
                let val_bytes = h_val.as_bytes();
                let name_len = name_bytes.len().min(64);
                let val_len = val_bytes.len().min(256);

                let mut header = AuroraUpstreamHeader::default();
                header.name[..name_len].copy_from_slice(&name_bytes[..name_len]);
                header.name_len = name_len as u32;
                header.value[..val_len].copy_from_slice(&val_bytes[..val_len]);
                header.value_len = val_len as u32;

                out.headers[h_idx] = header;
                h_idx += 1;
            }
            out.headers_count = h_idx as u32;
        }

        unsafe { ptr::write(out_decision, out) };
        0
    })) {
        Ok(code) => code,
        Err(_) => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_c_abi_lifecycle_and_evaluation() {
        let json = r#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "c-mirror-rule",
                    "origin": "api.example.com",
                    "path_prefix": "/orders",
                    "methods": ["POST"],
                    "primary_upstream": "orders_prod",
                    "mirror_upstream": "orders_shadow",
                    "sample_percentage": 100,
                    "mirror_headers": [
                        { "name": "X-Shadow", "value": "true" }
                    ]
                }
            ]
        }"#;

        let mut engine_ptr: *mut RequestMirrorEngine = ptr::null_mut();
        let status =
            unsafe { aurora_request_mirror_create(json.as_ptr(), json.len(), &mut engine_ptr) };
        assert_eq!(status, 0);
        assert!(!engine_ptr.is_null());

        let mut decision = AuroraMirrorDecision::default();

        // 1. Matching request: Host api.example.com, path /orders/new, method POST
        let origin = b"api.example.com";
        let path = b"/orders/new";
        let method = b"POST";
        let status = unsafe {
            aurora_request_mirror_evaluate(
                engine_ptr,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                method.as_ptr(),
                method.len(),
                42,
                &mut decision,
            )
        };
        assert_eq!(status, 0);
        assert_eq!(decision.matched, 1);
        assert_eq!(decision.is_mirrored, 1);
        assert_eq!(decision.primary_upstream_len, 11);
        assert_eq!(&decision.primary_upstream[..11], b"orders_prod");
        assert_eq!(decision.mirror_upstream_len, 13);
        assert_eq!(decision.headers_count, 2);
        assert_eq!(&decision.headers[0].name[..8], b"X-Shadow");
        assert_eq!(&decision.headers[0].value[..4], b"true");
        assert_eq!(&decision.headers[1].name[..16], b"x-request-mirror");
        assert_eq!(&decision.headers[1].value[..4], b"true");

        // 2. Mismatch method: GET should not match
        let method_get = b"GET";
        let status = unsafe {
            aurora_request_mirror_evaluate(
                engine_ptr,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                method_get.as_ptr(),
                method_get.len(),
                42,
                &mut decision,
            )
        };
        assert_eq!(status, 0);
        assert_eq!(decision.matched, 0);

        unsafe { aurora_request_mirror_destroy(engine_ptr) };
    }
}
