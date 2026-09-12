//! Foreign Function Interface (C ABI) for Rate Limiting.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process rate limiting engine. All functions are wrapped in catch_unwind
//! to prevent panics from crossing the foreign function boundary.

use crate::extensions::connection_limit::AuroraHeaderLookupFn;
use aurora_engine::rate_limit::{ActionOnExceeded, RateLimitEngine};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

pub const AURORA_RATE_LIMIT_MAX_HEADERS: usize = 8;
pub const AURORA_RATE_LIMIT_MAX_BODY: usize = 2048;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraRateLimitHeader {
    pub name_len: u32,
    pub value_len: u32,
    pub name: [u8; 64],
    pub value: [u8; 256],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraRateLimitDecision {
    pub allowed: u32,
    pub action: u32,
    pub status_code: u32,
    pub retry_after_secs: u32,
    pub remaining: u32,
    pub reset_epoch_secs: u64,
    pub headers_count: u32,
    pub headers: [AuroraRateLimitHeader; AURORA_RATE_LIMIT_MAX_HEADERS],
    pub body_len: u32,
    pub body: [u8; AURORA_RATE_LIMIT_MAX_BODY],
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_rate_limit_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_rate_limit_create(
    data: *const u8,
    len: usize,
    out: *mut *mut RateLimitEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        RateLimitEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_rate_limit_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_rate_limit_destroy(engine: *mut RateLimitEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured rate limiting rules.
/// Returns 0 for success (decision written to out_decision), 1 for invalid input,
/// and 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for their declared lengths. `engine` must be a valid handle
/// returned by `aurora_rate_limit_create`. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_rate_limit_evaluate(
    engine: *const RateLimitEngine,
    host: *const u8,
    host_len: usize,
    path: *const u8,
    path_len: usize,
    client_ip: *const u8,
    client_ip_len: usize,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraRateLimitDecision,
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
            if rc == 0 && !val_ptr.is_null() && val_len > 0 && val_len <= 16_384 {
                Some(unsafe { slice::from_raw_parts(val_ptr, val_len) })
            } else {
                None
            }
        };

        unsafe { &*engine }.evaluate(host_slice, path_slice, ip_slice, header_lookup)
    })) {
        Ok(Ok(decision)) => {
            let action_num = match decision.action {
                ActionOnExceeded::Throttle => 1,
                ActionOnExceeded::Block => 2,
                ActionOnExceeded::Audit => 3,
                ActionOnExceeded::CustomResponse => 4,
            };

            let mut out = AuroraRateLimitDecision {
                allowed: if decision.allowed { 1 } else { 0 },
                action: action_num,
                status_code: decision.status_code as u32,
                retry_after_secs: decision.retry_after_secs,
                remaining: decision.remaining,
                reset_epoch_secs: decision.reset_epoch_secs,
                headers_count: 0,
                headers: [AuroraRateLimitHeader {
                    name_len: 0,
                    value_len: 0,
                    name: [0; 64],
                    value: [0; 256],
                }; AURORA_RATE_LIMIT_MAX_HEADERS],
                body_len: 0,
                body: [0; AURORA_RATE_LIMIT_MAX_BODY],
            };

            let count = decision.headers.len().min(AURORA_RATE_LIMIT_MAX_HEADERS);
            out.headers_count = count as u32;
            for (i, h) in decision.headers.iter().take(count).enumerate() {
                let n = h.name.as_bytes();
                let nl = n.len().min(64);
                out.headers[i].name[..nl].copy_from_slice(&n[..nl]);
                out.headers[i].name_len = nl as u32;

                let v = h.value.as_bytes();
                let vl = v.len().min(256);
                out.headers[i].value[..vl].copy_from_slice(&v[..vl]);
                out.headers[i].value_len = vl as u32;
            }

            if let Some(ref b) = decision.body {
                let bl = b.len().min(AURORA_RATE_LIMIT_MAX_BODY);
                out.body[..bl].copy_from_slice(&b[..bl]);
                out.body_len = bl as u32;
            }

            unsafe {
                *out_decision = out;
            }
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_decision() -> AuroraRateLimitDecision {
        AuroraRateLimitDecision {
            allowed: 0,
            action: 0,
            status_code: 0,
            retry_after_secs: 0,
            remaining: 0,
            reset_epoch_secs: 0,
            headers_count: 0,
            headers: [AuroraRateLimitHeader {
                name_len: 0,
                value_len: 0,
                name: [0; 64],
                value: [0; 256],
            }; AURORA_RATE_LIMIT_MAX_HEADERS],
            body_len: 0,
            body: [0; AURORA_RATE_LIMIT_MAX_BODY],
        }
    }

    #[test]
    fn test_ffi_rate_limit_lifecycle() {
        let policy_json = serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "algorithm": "token_bucket",
            "memory_size_mb": 10,
            "max_keys": 10000,
            "eviction_policy": "lru",
            "overflow_strategy": "evict_and_track",
            "rules": [
                {
                    "id": "ffi_rule",
                    "host": "*",
                    "path_prefix": "/api",
                    "limit_by": "client_ip",
                    "rate": 1,
                    "burst": 1,
                    "period_secs": 10,
                    "action_on_exceeded": "throttle"
                }
            ]
        });

        let data = serde_json::to_vec(&policy_json).unwrap();
        let mut engine_ptr: *mut RateLimitEngine = ptr::null_mut();

        // Create engine
        let status =
            unsafe { aurora_rate_limit_create(data.as_ptr(), data.len(), &mut engine_ptr) };
        assert_eq!(status, 0);
        assert!(!engine_ptr.is_null());

        let host = b"example.com";
        let path = b"/api/v1/test";
        let ip = b"192.168.1.50";
        let mut decision = blank_decision();

        // 1st request -> allowed
        let eval_status1 = unsafe {
            aurora_rate_limit_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                None,
                &mut decision,
            )
        };
        assert_eq!(eval_status1, 0);
        assert_eq!(decision.allowed, 1);

        // 2nd request -> throttled
        let eval_status2 = unsafe {
            aurora_rate_limit_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                None,
                &mut decision,
            )
        };
        assert_eq!(eval_status2, 0);
        assert_eq!(decision.allowed, 0);
        assert_eq!(decision.action, 1); // Throttle
        assert_eq!(decision.status_code, 429);
        assert!(decision.retry_after_secs >= 1);

        // Destroy engine
        unsafe { aurora_rate_limit_destroy(engine_ptr) };
    }

    #[test]
    fn test_ffi_rate_limit_custom_response() {
        let policy_json = serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "algorithm": "token_bucket",
            "memory_size_mb": 10,
            "max_keys": 10000,
            "eviction_policy": "lru",
            "overflow_strategy": "evict_and_track",
            "rules": [
                {
                    "id": "custom_rule",
                    "host": "*",
                    "path_prefix": "/custom",
                    "limit_by": "client_ip",
                    "rate": 1,
                    "burst": 1,
                    "period_secs": 10,
                    "action_on_exceeded": "custom_response",
                    "rejected_code": 403,
                    "custom_message": "{\"error\":\"blocked\",\"remaining\":$remaining}",
                    "response_headers": [
                        { "name": "X-RateLimit-Retry", "value": "${retry_after}s" },
                        { "name": "X-Custom-Header", "value": "aurora-waf" }
                    ]
                }
            ]
        });

        let data = serde_json::to_vec(&policy_json).unwrap();
        let mut engine_ptr: *mut RateLimitEngine = ptr::null_mut();

        let status =
            unsafe { aurora_rate_limit_create(data.as_ptr(), data.len(), &mut engine_ptr) };
        assert_eq!(status, 0);

        let host = b"example.com";
        let path = b"/custom/test";
        let ip = b"10.0.0.1";
        let mut decision = blank_decision();

        // 1st request -> allowed
        let res1 = unsafe {
            aurora_rate_limit_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                None,
                &mut decision,
            )
        };
        assert_eq!(res1, 0);
        assert_eq!(decision.allowed, 1);

        // 2nd request -> custom rejected
        let res2 = unsafe {
            aurora_rate_limit_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ptr::null_mut(),
                None,
                &mut decision,
            )
        };
        assert_eq!(res2, 0);
        assert_eq!(decision.allowed, 0);
        assert_eq!(decision.action, 4); // CustomResponse
        assert_eq!(decision.status_code, 403);
        assert_eq!(decision.headers_count, 2);

        let h0_name =
            std::str::from_utf8(&decision.headers[0].name[..decision.headers[0].name_len as usize])
                .unwrap();
        let h0_val = std::str::from_utf8(
            &decision.headers[0].value[..decision.headers[0].value_len as usize],
        )
        .unwrap();
        assert_eq!(h0_name, "X-RateLimit-Retry");
        assert!(h0_val.ends_with('s'));

        let h1_name =
            std::str::from_utf8(&decision.headers[1].name[..decision.headers[1].name_len as usize])
                .unwrap();
        let h1_val = std::str::from_utf8(
            &decision.headers[1].value[..decision.headers[1].value_len as usize],
        )
        .unwrap();
        assert_eq!(h1_name, "X-Custom-Header");
        assert_eq!(h1_val, "aurora-waf");

        let body_str = std::str::from_utf8(&decision.body[..decision.body_len as usize]).unwrap();
        assert_eq!(body_str, "{\"error\":\"blocked\",\"remaining\":0}");

        unsafe { aurora_rate_limit_destroy(engine_ptr) };
    }
}
