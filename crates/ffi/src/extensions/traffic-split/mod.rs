//! Foreign Function Interface (C ABI) for Traffic Split.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process traffic split engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use crate::extensions::connection_limit::AuroraHeaderLookupFn;
use aurora_engine::traffic_split::{TrafficSplitEngine, TrafficSplitEvalRequest};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraTrafficSplitDecision {
    pub matched: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub upstream_len: u32,
    pub upstream: [u8; 128],
}

impl Default for AuroraTrafficSplitDecision {
    fn default() -> Self {
        Self {
            matched: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
            upstream_len: 0,
            upstream: [0u8; 128],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_traffic_split_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_split_create(
    data: *const u8,
    len: usize,
    out: *mut *mut TrafficSplitEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        TrafficSplitEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_traffic_split_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_split_destroy(engine: *mut TrafficSplitEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured traffic split rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_split_evaluate(
    engine: *const TrafficSplitEngine,
    origin: *const u8,
    origin_len: usize,
    path: *const u8,
    path_len: usize,
    client_ip: *const u8,
    client_ip_len: usize,
    random_seed: u32,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraTrafficSplitDecision,
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

        let eng = unsafe { &*engine };
        let req = TrafficSplitEvalRequest {
            origin: origin_slice,
            path: path_slice,
            client_ip: ip_slice,
            random_seed,
        };

        let decision = eng.evaluate(&req, header_lookup);

        let mut out = AuroraTrafficSplitDecision {
            matched: if decision.matched { 1 } else { 0 },
            rule_id_len: 0,
            rule_id: [0u8; 128],
            upstream_len: 0,
            upstream: [0u8; 128],
        };

        if decision.matched {
            let id_bytes = decision.rule_id.as_bytes();
            let copy_id = id_bytes.len().min(128);
            out.rule_id[..copy_id].copy_from_slice(&id_bytes[..copy_id]);
            out.rule_id_len = copy_id as u32;

            let up_bytes = decision.upstream.as_bytes();
            let copy_up = up_bytes.len().min(128);
            out.upstream[..copy_up].copy_from_slice(&up_bytes[..copy_up]);
            out.upstream_len = copy_up as u32;
        }

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
        if name_slice == b"x-canary" {
            static VAL: &[u8] = b"always-v2";
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
    fn test_traffic_split_c_abi_lifecycle_and_eval() {
        let json = br#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "split-v1-v2",
                    "priority": 10,
                    "origin": "*",
                    "path_prefix": "/api",
                    "split_by": "header",
                    "header_name": "x-canary",
                    "splits": [
                        { "upstream": "backend_v1", "weight": 50 },
                        { "upstream": "backend_v2", "weight": 50 }
                    ]
                }
            ]
        }"#;

        unsafe {
            let mut engine: *mut TrafficSplitEngine = ptr::null_mut();
            let rc = aurora_traffic_split_create(json.as_ptr(), json.len(), &mut engine);
            assert_eq!(rc, 0);
            assert!(!engine.is_null());

            let mut decision = AuroraTrafficSplitDecision::default();

            let origin = b"example.com";
            let path = b"/api/v1/resource";
            let ip = b"192.168.1.1";

            let eval_rc = aurora_traffic_split_evaluate(
                engine,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                0,
                ptr::null_mut(),
                Some(mock_header_lookup),
                &mut decision,
            );
            assert_eq!(eval_rc, 0);
            assert_eq!(decision.matched, 1);
            assert_eq!(&decision.rule_id[..decision.rule_id_len as usize], b"split-v1-v2");
            let chosen = std::str::from_utf8(&decision.upstream[..decision.upstream_len as usize]).unwrap();
            assert!(chosen == "backend_v1" || chosen == "backend_v2");

            aurora_traffic_split_destroy(engine);
        }
    }
}
