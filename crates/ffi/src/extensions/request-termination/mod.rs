//! Foreign Function Interface (C ABI) for Request Termination.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process request-termination engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use aurora_engine::request_termination::{RequestTerminationEngine, RequestTerminationEvalRequest};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraResponseHeader {
    pub name_len: u32,
    pub name: [u8; 64],
    pub value_len: u32,
    pub value: [u8; 256],
}

impl Default for AuroraResponseHeader {
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
#[derive(Clone, Copy, Debug)]
pub struct AuroraIncomingHeader {
    pub name_ptr: *const u8,
    pub name_len: usize,
    pub value_ptr: *const u8,
    pub value_len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct AuroraTerminationDecision {
    pub matched: u32,
    pub should_terminate: u32,
    pub status_code: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub content_type_len: u32,
    pub content_type: [u8; 128],
    pub body_len: u32,
    pub body: *const u8,
    pub headers_count: u32,
    pub headers: [AuroraResponseHeader; 16],
}

impl Default for AuroraTerminationDecision {
    fn default() -> Self {
        Self {
            matched: 0,
            should_terminate: 0,
            status_code: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
            content_type_len: 0,
            content_type: [0u8; 128],
            body_len: 0,
            body: ptr::null(),
            headers_count: 0,
            headers: [AuroraResponseHeader::default(); 16],
        }
    }
}

/// Create a new RequestTerminationEngine from JSON bytes.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_request_termination_create(
    policy_ptr: *const u8,
    policy_len: usize,
    engine_out: *mut *mut RequestTerminationEngine,
) -> u32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if policy_ptr.is_null() || engine_out.is_null() {
            return 1;
        }

        let policy_bytes = unsafe { slice::from_raw_parts(policy_ptr, policy_len) };

        match RequestTerminationEngine::from_snapshot(policy_bytes) {
            Ok(engine) => {
                let boxed = Box::new(engine);
                unsafe {
                    *engine_out = Box::into_raw(boxed);
                }
                0
            }
            Err(_) => 2,
        }
    }));

    result.unwrap_or(2)
}

/// Destroy a previously allocated RequestTerminationEngine.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_request_termination_destroy(engine_ptr: *mut RequestTerminationEngine) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if !engine_ptr.is_null() {
            unsafe {
                drop(Box::from_raw(engine_ptr));
            }
        }
    }));
}

/// Evaluate request-termination policy on the hot path.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_request_termination_evaluate(
    engine_ptr: *const RequestTerminationEngine,
    origin_ptr: *const u8,
    origin_len: usize,
    path_ptr: *const u8,
    path_len: usize,
    method_ptr: *const u8,
    method_len: usize,
    headers_ptr: *const AuroraIncomingHeader,
    headers_count: usize,
    decision_out: *mut AuroraTerminationDecision,
) -> u32 {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if engine_ptr.is_null()
            || origin_ptr.is_null()
            || path_ptr.is_null()
            || method_ptr.is_null()
            || decision_out.is_null()
        {
            return 1;
        }

        let engine = unsafe { &*engine_ptr };
        let host = unsafe { slice::from_raw_parts(origin_ptr, origin_len) };
        let path = unsafe { slice::from_raw_parts(path_ptr, path_len) };
        let method = unsafe { slice::from_raw_parts(method_ptr, method_len) };

        let mut req_headers = Vec::with_capacity(headers_count.min(32));
        if !headers_ptr.is_null() && headers_count > 0 {
            let incoming = unsafe { slice::from_raw_parts(headers_ptr, headers_count) };
            for h in incoming {
                if !h.name_ptr.is_null() && !h.value_ptr.is_null() {
                    let k = unsafe { slice::from_raw_parts(h.name_ptr, h.name_len) };
                    let v = unsafe { slice::from_raw_parts(h.value_ptr, h.value_len) };
                    req_headers.push((k, v));
                }
            }
        }

        let req = RequestTerminationEvalRequest {
            host,
            path,
            method,
            headers: &req_headers,
        };

        let decision = engine.evaluate(&req);

        let out = unsafe { &mut *decision_out };
        out.matched = if decision.matched { 1 } else { 0 };
        out.should_terminate = if decision.should_terminate { 1 } else { 0 };
        out.status_code = decision.status_code as u32;

        let r_id = decision.rule_id.as_bytes();
        let r_len = r_id.len().min(128);
        out.rule_id_len = r_len as u32;
        out.rule_id[..r_len].copy_from_slice(&r_id[..r_len]);

        let ct = decision.content_type.as_bytes();
        let ct_len = ct.len().min(128);
        out.content_type_len = ct_len as u32;
        out.content_type[..ct_len].copy_from_slice(&ct[..ct_len]);

        out.body_len = decision.body.len() as u32;
        out.body = decision.body.as_ptr();

        let count = decision.headers.len().min(16);
        out.headers_count = count as u32;

        for (i, (k, v)) in decision.headers.iter().take(16).enumerate() {
            let k_bytes = k.as_bytes();
            let k_len = k_bytes.len().min(64);
            out.headers[i].name_len = k_len as u32;
            out.headers[i].name[..k_len].copy_from_slice(&k_bytes[..k_len]);

            let v_bytes = v.as_bytes();
            let v_len = v_bytes.len().min(256);
            out.headers[i].value_len = v_len as u32;
            out.headers[i].value[..v_len].copy_from_slice(&v_bytes[..v_len]);
        }

        0
    }));

    result.unwrap_or(2)
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
                    "id": "maintenance-v1",
                    "priority": 1,
                    "origin": "*",
                    "path_prefix": "/api",
                    "methods": ["GET", "POST"],
                    "status_code": 503,
                    "content_type": "application/json",
                    "body": "{\"error\":\"Under Maintenance\"}",
                    "headers": [
                        { "name": "Retry-After", "value": "300" }
                    ],
                    "bypass_headers": [
                        { "name": "X-Bypass-Secret", "value": "key_ok" }
                    ]
                }
            ]
        }"#;

        let mut engine_ptr: *mut RequestTerminationEngine = ptr::null_mut();
        let status = aurora_request_termination_create(json.as_ptr(), json.len(), &mut engine_ptr);
        assert_eq!(status, 0);
        assert!(!engine_ptr.is_null());

        let origin = b"example.com";
        let path = b"/api/v1/checkout";
        let method = b"POST";

        // 1. Regular client without bypass header -> should_terminate == 1
        let mut decision = AuroraTerminationDecision::default();
        let status = unsafe {
            aurora_request_termination_evaluate(
                engine_ptr,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                method.as_ptr(),
                method.len(),
                ptr::null(),
                0,
                &mut decision,
            )
        };
        assert_eq!(status, 0);
        assert_eq!(decision.matched, 1);
        assert_eq!(decision.should_terminate, 1);
        assert_eq!(decision.status_code, 503);
        assert_eq!(
            &decision.content_type[..decision.content_type_len as usize],
            b"application/json"
        );
        assert_eq!(decision.body_len, 29);
        assert_eq!(decision.headers_count, 1);
        assert_eq!(&decision.headers[0].name[..11], b"Retry-After");
        assert_eq!(&decision.headers[0].value[..3], b"300");

        // 2. Admin with bypass header -> matched == 1, should_terminate == 0
        let bypass_hdr = AuroraIncomingHeader {
            name_ptr: b"x-bypass-secret".as_ptr(),
            name_len: 15,
            value_ptr: b"key_ok".as_ptr(),
            value_len: 6,
        };
        let mut decision_admin = AuroraTerminationDecision::default();
        let status = unsafe {
            aurora_request_termination_evaluate(
                engine_ptr,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                method.as_ptr(),
                method.len(),
                &bypass_hdr,
                1,
                &mut decision_admin,
            )
        };
        assert_eq!(status, 0);
        assert_eq!(decision_admin.matched, 1);
        assert_eq!(decision_admin.should_terminate, 0);

        aurora_request_termination_destroy(engine_ptr);
    }
}
