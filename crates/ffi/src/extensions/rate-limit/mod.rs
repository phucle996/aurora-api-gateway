//! Foreign Function Interface (C ABI) for Rate Limiting.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process rate limiting engine. All functions are wrapped in catch_unwind
//! to prevent panics from crossing the foreign function boundary.

use aurora_engine::rate_limit::{ActionOnExceeded, RateLimitEngine};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraRateLimitDecision {
    pub allowed: u32,
    pub action: u32,
    pub status_code: u32,
    pub retry_after_secs: u32,
    pub remaining: u32,
    pub reset_epoch_secs: u64,
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
    api_key: *const u8,
    api_key_len: usize,
    authorization: *const u8,
    authorization_len: usize,
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
        || (api_key.is_null() && api_key_len != 0)
        || api_key_len > 1_024
        || (authorization.is_null() && authorization_len != 0)
        || authorization_len > 16_384
    {
        return 1;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let host_slice = unsafe { slice::from_raw_parts(host, host_len) };
        let path_slice = unsafe { slice::from_raw_parts(path, path_len) };
        let ip_slice = unsafe { slice::from_raw_parts(client_ip, client_ip_len) };
        let api_key_opt = if api_key.is_null() || api_key_len == 0 {
            None
        } else {
            Some(unsafe { slice::from_raw_parts(api_key, api_key_len) })
        };
        let auth_opt = if authorization.is_null() || authorization_len == 0 {
            None
        } else {
            Some(unsafe { slice::from_raw_parts(authorization, authorization_len) })
        };

        unsafe { &*engine }.evaluate(host_slice, path_slice, ip_slice, api_key_opt, auth_opt)
    })) {
        Ok(Ok(decision)) => {
            let action_num = match decision.action {
                ActionOnExceeded::Throttle => 1,
                ActionOnExceeded::Block => 2,
                ActionOnExceeded::Audit => 3,
                ActionOnExceeded::CustomResponse => 4,
            };

            unsafe {
                *out_decision = AuroraRateLimitDecision {
                    allowed: if decision.allowed { 1 } else { 0 },
                    action: action_num,
                    status_code: decision.status_code as u32,
                    retry_after_secs: decision.retry_after_secs,
                    remaining: decision.remaining,
                    reset_epoch_secs: decision.reset_epoch_secs,
                };
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
        let status = unsafe { aurora_rate_limit_create(data.as_ptr(), data.len(), &mut engine_ptr) };
        assert_eq!(status, 0);
        assert!(!engine_ptr.is_null());

        let host = b"example.com";
        let path = b"/api/v1/test";
        let ip = b"192.168.1.50";
        let mut decision = AuroraRateLimitDecision {
            allowed: 0,
            action: 0,
            status_code: 0,
            retry_after_secs: 0,
            remaining: 0,
            reset_epoch_secs: 0,
        };

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
                ptr::null(),
                0,
                ptr::null(),
                0,
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
                ptr::null(),
                0,
                ptr::null(),
                0,
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
}
