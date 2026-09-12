//! Foreign Function Interface (C ABI) for Connection Limiting.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process and distributed connection limiting engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use aurora_engine::connection_limit::{
    ActionOnExceeded, ConnLimitToken, ConnectionLimitEngine,
};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

pub const AURORA_CONN_LIMIT_MAX_HEADERS: usize = 8;
pub const AURORA_CONN_LIMIT_MAX_BODY: usize = 2048;

pub type AuroraHeaderLookupFn = unsafe extern "C" fn(
    ctx: *mut std::ffi::c_void,
    name: *const u8,
    name_len: usize,
    out_val: *mut *const u8,
    out_val_len: *mut usize,
) -> u32;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraConnLimitHeader {
    pub name_len: u32,
    pub value_len: u32,
    pub name: [u8; 64],
    pub value: [u8; 256],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraConnLimitToken {
    pub is_redis: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub identifier_len: u32,
    pub identifier: [u8; 128],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraConnLimitDecision {
    pub allowed: u32,
    pub action: u32,
    pub status_code: u32,
    pub current_connections: u32,
    pub max_connections: u32,
    pub has_token: u32,
    pub token: AuroraConnLimitToken,
    pub headers_count: u32,
    pub headers: [AuroraConnLimitHeader; AURORA_CONN_LIMIT_MAX_HEADERS],
    pub body_len: u32,
    pub body: [u8; AURORA_CONN_LIMIT_MAX_BODY],
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_conn_limit_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_conn_limit_create(
    data: *const u8,
    len: usize,
    out: *mut *mut ConnectionLimitEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        ConnectionLimitEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_conn_limit_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_conn_limit_destroy(engine: *mut ConnectionLimitEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates and acquires a connection slot against configured connection limit rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_conn_limit_acquire(
    engine: *const ConnectionLimitEngine,
    host: *const u8,
    host_len: usize,
    path: *const u8,
    path_len: usize,
    client_ip: *const u8,
    client_ip_len: usize,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraConnLimitDecision,
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
            let rc = unsafe { f(lookup_ctx, name.as_ptr(), name.len(), &mut val_ptr, &mut val_len) };
            if rc == 0 && !val_ptr.is_null() && val_len > 0 && val_len <= 16_384 {
                Some(unsafe { slice::from_raw_parts(val_ptr, val_len) })
            } else {
                None
            }
        };

        unsafe { &*engine }.acquire(host_slice, path_slice, ip_slice, header_lookup)
    })) {
        Ok(Ok(decision)) => {
            let action_num = match decision.action {
                ActionOnExceeded::Throttle => 1,
                ActionOnExceeded::Block => 2,
                ActionOnExceeded::Audit => 3,
                ActionOnExceeded::CustomResponse => 4,
            };

            let mut out = AuroraConnLimitDecision {
                allowed: if decision.allowed { 1 } else { 0 },
                action: action_num,
                status_code: decision.status_code as u32,
                current_connections: decision.current_connections,
                max_connections: decision.max_connections,
                has_token: 0,
                token: AuroraConnLimitToken {
                    is_redis: 0,
                    rule_id_len: 0,
                    rule_id: [0u8; 128],
                    identifier_len: 0,
                    identifier: [0u8; 128],
                },
                headers_count: 0,
                headers: [AuroraConnLimitHeader {
                    name_len: 0,
                    value_len: 0,
                    name: [0u8; 64],
                    value: [0u8; 256],
                }; AURORA_CONN_LIMIT_MAX_HEADERS],
                body_len: 0,
                body: [0u8; AURORA_CONN_LIMIT_MAX_BODY],
            };

            if let Some(token) = decision.token {
                out.has_token = 1;
                out.token.is_redis = if token.is_redis { 1 } else { 0 };
                let r_bytes = token.rule_id.as_bytes();
                let r_len = r_bytes.len().min(128);
                out.token.rule_id_len = r_len as u32;
                out.token.rule_id[..r_len].copy_from_slice(&r_bytes[..r_len]);

                let id_len = token.identifier.len().min(128);
                out.token.identifier_len = id_len as u32;
                out.token.identifier[..id_len].copy_from_slice(&token.identifier[..id_len]);
            }

            let num_hdrs = decision.headers.len().min(AURORA_CONN_LIMIT_MAX_HEADERS);
            out.headers_count = num_hdrs as u32;
            for i in 0..num_hdrs {
                let h = &decision.headers[i];
                let n_len = h.name.len().min(64);
                let v_len = h.value.len().min(256);
                out.headers[i].name_len = n_len as u32;
                out.headers[i].value_len = v_len as u32;
                out.headers[i].name[..n_len].copy_from_slice(&h.name.as_bytes()[..n_len]);
                out.headers[i].value[..v_len].copy_from_slice(&h.value.as_bytes()[..v_len]);
            }

            if let Some(ref body_vec) = decision.body {
                let b_len = body_vec.len().min(AURORA_CONN_LIMIT_MAX_BODY);
                out.body_len = b_len as u32;
                out.body[..b_len].copy_from_slice(&body_vec[..b_len]);
            }

            unsafe { *out_decision = out };
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}

/// Releases an acquired connection slot.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be valid. `engine` must be a valid handle, `token` must point to an AuroraConnLimitToken.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_conn_limit_release(
    engine: *const ConnectionLimitEngine,
    token: *const AuroraConnLimitToken,
) -> u32 {
    if engine.is_null() || token.is_null() {
        return 1;
    }

    catch_unwind(AssertUnwindSafe(|| {
        let tok = unsafe { &*token };
        if tok.rule_id_len == 0
            || tok.rule_id_len > 128
            || tok.identifier_len == 0
            || tok.identifier_len > 128
        {
            return 1;
        }

        let rule_id = match std::str::from_utf8(&tok.rule_id[..tok.rule_id_len as usize]) {
            Ok(s) => s.to_string(),
            Err(_) => return 1,
        };
        let identifier = tok.identifier[..tok.identifier_len as usize].to_vec();

        unsafe { &*engine }.release(&ConnLimitToken {
            rule_id,
            identifier,
            is_redis: tok.is_redis == 1,
        });
        0
    }))
    .unwrap_or(2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_c_abi_create_acquire_release_destroy() {
        let policy = json!({
            "schema_version": 1,
            "generation": 1,
            "mode": "local",
            "rules": [
                {
                    "id": "rule-abi-1",
                    "host": "*",
                    "path_prefix": "/abi",
                    "limit_by": "client_ip",
                    "max_connections": 1,
                    "action_on_exceeded": "throttle"
                }
            ]
        });
        let bytes = serde_json::to_vec(&policy).unwrap();

        let mut engine_ptr: *mut ConnectionLimitEngine = ptr::null_mut();
        let rc = unsafe { aurora_conn_limit_create(bytes.as_ptr(), bytes.len(), &mut engine_ptr) };
        assert_eq!(rc, 0);
        assert!(!engine_ptr.is_null());

        let host = b"example.com";
        let path = b"/abi/test";
        let ip = b"127.0.0.1";

        let mut decision = AuroraConnLimitDecision {
            allowed: 0,
            action: 0,
            status_code: 0,
            current_connections: 0,
            max_connections: 0,
            has_token: 0,
            token: AuroraConnLimitToken {
                is_redis: 0,
                rule_id_len: 0,
                rule_id: [0u8; 128],
                identifier_len: 0,
                identifier: [0u8; 128],
            },
            headers_count: 0,
            headers: [AuroraConnLimitHeader {
                name_len: 0,
                value_len: 0,
                name: [0u8; 64],
                value: [0u8; 256],
            }; AURORA_CONN_LIMIT_MAX_HEADERS],
            body_len: 0,
            body: [0u8; AURORA_CONN_LIMIT_MAX_BODY],
        };

        // Acquire slot 1
        let rc = unsafe {
            aurora_conn_limit_acquire(
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
        assert_eq!(rc, 0);
        assert_eq!(decision.allowed, 1);
        assert_eq!(decision.has_token, 1);

        let saved_token = decision.token;

        // Acquire slot 2 (should fail)
        let rc = unsafe {
            aurora_conn_limit_acquire(
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
        assert_eq!(rc, 0);
        assert_eq!(decision.allowed, 0);
        assert_eq!(decision.has_token, 0);

        // Release slot 1
        let rc = unsafe { aurora_conn_limit_release(engine_ptr, &saved_token) };
        assert_eq!(rc, 0);

        // Acquire slot again (should succeed)
        let rc = unsafe {
            aurora_conn_limit_acquire(
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
        assert_eq!(rc, 0);
        assert_eq!(decision.allowed, 1);

        unsafe { aurora_conn_limit_destroy(engine_ptr) };
    }

    unsafe extern "C" fn mock_header_lookup(
        ctx: *mut std::ffi::c_void,
        name: *const u8,
        name_len: usize,
        out_val: *mut *const u8,
        out_val_len: *mut usize,
    ) -> u32 {
        if ctx.is_null() || name.is_null() || out_val.is_null() || out_val_len.is_null() {
            return 1;
        }
        let name_slice = unsafe { slice::from_raw_parts(name, name_len) };
        if name_slice == b"x-api-key" {
            let val = b"secret-token-123";
            unsafe {
                *out_val = val.as_ptr();
                *out_val_len = val.len();
            }
            0
        } else {
            1
        }
    }

    #[test]
    fn test_c_abi_header_lookup() {
        let policy = json!({
            "schema_version": 1,
            "generation": 1,
            "mode": "local",
            "rules": [
                {
                    "id": "rule-header-1",
                    "host": "*",
                    "path_prefix": "/api",
                    "limit_by": "header",
                    "header_name": "x-api-key",
                    "max_connections": 1,
                    "action_on_exceeded": "throttle"
                }
            ]
        });
        let bytes = serde_json::to_vec(&policy).unwrap();

        let mut engine_ptr: *mut ConnectionLimitEngine = ptr::null_mut();
        let rc = unsafe { aurora_conn_limit_create(bytes.as_ptr(), bytes.len(), &mut engine_ptr) };
        assert_eq!(rc, 0);

        let host = b"example.com";
        let path = b"/api/test";
        let ip = b"127.0.0.1";

        let mut decision = AuroraConnLimitDecision {
            allowed: 0,
            action: 0,
            status_code: 0,
            current_connections: 0,
            max_connections: 0,
            has_token: 0,
            token: AuroraConnLimitToken {
                is_redis: 0,
                rule_id_len: 0,
                rule_id: [0u8; 128],
                identifier_len: 0,
                identifier: [0u8; 128],
            },
            headers_count: 0,
            headers: [AuroraConnLimitHeader {
                name_len: 0,
                value_len: 0,
                name: [0u8; 64],
                value: [0u8; 256],
            }; AURORA_CONN_LIMIT_MAX_HEADERS],
            body_len: 0,
            body: [0u8; AURORA_CONN_LIMIT_MAX_BODY],
        };

        let mut dummy_ctx: u32 = 42;
        let ctx_ptr = &mut dummy_ctx as *mut u32 as *mut std::ffi::c_void;

        let rc = unsafe {
            aurora_conn_limit_acquire(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path.as_ptr(),
                path.len(),
                ip.as_ptr(),
                ip.len(),
                ctx_ptr,
                Some(mock_header_lookup),
                &mut decision,
            )
        };
        assert_eq!(rc, 0);
        assert_eq!(decision.allowed, 1);
        assert_eq!(decision.has_token, 1);

        let id_slice = &decision.token.identifier[..decision.token.identifier_len as usize];
        assert_eq!(id_slice, b"secret-token-123");

        unsafe { aurora_conn_limit_destroy(engine_ptr) };
    }
}
