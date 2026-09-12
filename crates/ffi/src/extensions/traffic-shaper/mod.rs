//! Foreign Function Interface (C ABI) for Traffic Shaper.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process traffic shaper engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use crate::extensions::connection_limit::AuroraHeaderLookupFn;
use aurora_engine::traffic_shaper::TrafficShaperEngine;
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraTrafficShaperDecision {
    pub rate_bytes_per_sec: u64,
    pub burst_bytes: u64,
    pub matched: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
}

impl Default for AuroraTrafficShaperDecision {
    fn default() -> Self {
        Self {
            rate_bytes_per_sec: 0,
            burst_bytes: 0,
            matched: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_traffic_shaper_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_shaper_create(
    data: *const u8,
    len: usize,
    out: *mut *mut TrafficShaperEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        TrafficShaperEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_traffic_shaper_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_shaper_destroy(engine: *mut TrafficShaperEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured traffic shaper rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_traffic_shaper_evaluate(
    engine: *const TrafficShaperEngine,
    host: *const u8,
    host_len: usize,
    path: *const u8,
    path_len: usize,
    client_ip: *const u8,
    client_ip_len: usize,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraTrafficShaperDecision,
) -> u32 {
    if engine.is_null()
        || out_decision.is_null()
        || host.is_null()
        || host_len == 0
        || host_len > 253
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
        let host_slice = unsafe { slice::from_raw_parts(host, host_len) };
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
        let decision = eng.evaluate(host_slice, path_slice, ip_slice, header_lookup);

        let mut out = AuroraTrafficShaperDecision {
            rate_bytes_per_sec: decision.rate_bytes_per_sec,
            burst_bytes: decision.burst_bytes,
            matched: if decision.matched { 1 } else { 0 },
            rule_id_len: 0,
            rule_id: [0u8; 128],
        };

        let id_bytes = decision.rule_id.as_bytes();
        let copy_len = id_bytes.len().min(128);
        out.rule_id[..copy_len].copy_from_slice(&id_bytes[..copy_len]);
        out.rule_id_len = copy_len as u32;

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
        if name_slice == b"x-tier" {
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
    fn test_traffic_shaper_c_abi_lifecycle_and_eval() {
        let json = br#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "vip-tier",
                    "priority": 10,
                    "host": "*",
                    "path_prefix": "/download",
                    "limit_by": "header",
                    "header_name": "x-tier",
                    "rate_kb_per_sec": 10240,
                    "burst_kb": 20480
                },
                {
                    "id": "default-tier",
                    "priority": 20,
                    "host": "*",
                    "path_prefix": "/download",
                    "limit_by": "client_ip",
                    "rate_kb_per_sec": 512,
                    "burst_kb": 1024
                }
            ]
        }"#;

        unsafe {
            let mut engine: *mut TrafficShaperEngine = ptr::null_mut();
            let rc = aurora_traffic_shaper_create(json.as_ptr(), json.len(), &mut engine);
            assert_eq!(rc, 0);
            assert!(!engine.is_null());

            let mut decision = AuroraTrafficShaperDecision::default();

            // 1. With mock header lookup returning "vip"
            let host = b"example.com";
            let path = b"/download/file.tar";
            let ip = b"10.0.0.1";

            let eval_rc = aurora_traffic_shaper_evaluate(
                engine,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                Some(mock_header_lookup),
                &mut decision,
            );
            assert_eq!(eval_rc, 0);
            assert_eq!(decision.matched, 1);
            assert_eq!(decision.rate_bytes_per_sec, 10240 * 1024);
            assert_eq!(decision.burst_bytes, 20480 * 1024);
            assert_eq!(
                &decision.rule_id[..decision.rule_id_len as usize],
                b"vip-tier"
            );

            // 2. Without lookup function -> falls through to default-tier
            let eval_rc2 = aurora_traffic_shaper_evaluate(
                engine,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                None,
                &mut decision,
            );
            assert_eq!(eval_rc2, 0);
            assert_eq!(decision.matched, 1);
            assert_eq!(decision.rate_bytes_per_sec, 512 * 1024);
            assert_eq!(
                &decision.rule_id[..decision.rule_id_len as usize],
                b"default-tier"
            );

            aurora_traffic_shaper_destroy(engine);
        }
    }
}
