use aurora_engine::jwt::{JwtDecision, JwtEngine};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

pub const AURORA_JWT_MAX_FORWARD_HEADERS: usize = 16;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct AuroraJwtHeader {
    pub name_len: u32,
    pub value_len: u32,
    pub name: [u8; 64],
    pub value: [u8; 256],
}

#[repr(C)]
pub struct AuroraJwtDecision {
    pub allowed: u32, // 1 = allow, 0 = unauthorized
    pub headers_count: u32,
    pub headers: [AuroraJwtHeader; AURORA_JWT_MAX_FORWARD_HEADERS],
}

impl Default for AuroraJwtDecision {
    fn default() -> Self {
        Self {
            allowed: 0,
            headers_count: 0,
            headers: [AuroraJwtHeader {
                name_len: 0,
                value_len: 0,
                name: [0u8; 64],
                value: [0u8; 256],
            }; AURORA_JWT_MAX_FORWARD_HEADERS],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_jwt_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_jwt_create(
    data: *const u8,
    len: usize,
    out: *mut *mut JwtEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        JwtEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
/// The handle must be a live engine returned by `aurora_jwt_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_jwt_destroy(engine: *mut JwtEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates JWT credentials for a request and populates `out_decision`.
/// Returns 0 for success, 1 for invalid request parameters, and 2 for internal/panic error.
///
/// # Safety
/// Every non-null byte pointer must be readable for its declared length and
/// `engine` must be a live handle from `aurora_jwt_create`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_jwt_evaluate(
    engine: *const JwtEngine,
    host: *const u8,
    host_len: usize,
    path: *const u8,
    path_len: usize,
    authorization: *const u8,
    authorization_len: usize,
    out_decision: *mut AuroraJwtDecision,
) -> u32 {
    if engine.is_null()
        || host.is_null()
        || host_len == 0
        || host_len > 253
        || path.is_null()
        || path_len == 0
        || path_len > 8_192
        || (authorization.is_null() && authorization_len != 0)
        || authorization_len > 16_384
        || out_decision.is_null()
    {
        return 1;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let authorization = if authorization.is_null() {
            None
        } else {
            Some(unsafe { slice::from_raw_parts(authorization, authorization_len) })
        };
        unsafe { &*engine }.evaluate(
            unsafe { slice::from_raw_parts(host, host_len) },
            unsafe { slice::from_raw_parts(path, path_len) },
            authorization,
        )
    })) {
        Ok(Ok(decision)) => {
            let mut res = AuroraJwtDecision::default();
            match decision {
                JwtDecision::Allow { forwarded_headers } => {
                    res.allowed = 1;
                    let count = forwarded_headers.len().min(AURORA_JWT_MAX_FORWARD_HEADERS);
                    res.headers_count = count as u32;
                    for (i, (k, v)) in forwarded_headers.into_iter().take(count).enumerate() {
                        let k_bytes = k.as_bytes();
                        let v_bytes = v.as_bytes();
                        let k_len = k_bytes.len().min(64);
                        let v_len = v_bytes.len().min(256);
                        res.headers[i].name_len = k_len as u32;
                        res.headers[i].value_len = v_len as u32;
                        res.headers[i].name[..k_len].copy_from_slice(&k_bytes[..k_len]);
                        res.headers[i].value[..v_len].copy_from_slice(&v_bytes[..v_len]);
                    }
                }
                JwtDecision::Unauthorized => {
                    res.allowed = 0;
                    res.headers_count = 0;
                }
            }
            unsafe { *out_decision = res };
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{EncodingKey, Header, encode};
    use serde::Serialize;

    #[derive(Serialize)]
    struct Claims {
        sub: String,
        role: String,
        exp: usize,
    }

    #[test]
    fn test_ffi_jwt_lifecycle_and_claims_forwarding() {
        let secret = "ffi-secret-12345678901234567890";
        let policy_json = serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "origins": [
                {
                    "id": "ffi-origin",
                    "origin": "api.test.local",
                    "path_prefix": "/api",
                    "exclude_paths": ["/api/health"],
                    "algorithm": "HS256",
                    "secret": secret,
                    "forward_headers": [
                        { "payload_key": "sub", "header_key": "X-User-Id", "value": "*" },
                        { "payload_key": "role", "header_key": "X-User-Role", "value": "^admin$" }
                    ]
                }
            ]
        });
        let policy_bytes = policy_json.to_string();

        let mut engine_ptr: *mut JwtEngine = ptr::null_mut();
        let create_res = unsafe {
            aurora_jwt_create(
                policy_bytes.as_ptr(),
                policy_bytes.len(),
                &mut engine_ptr,
            )
        };
        assert_eq!(create_res, 0);
        assert!(!engine_ptr.is_null());

        let host = b"api.test.local";
        let mut decision = AuroraJwtDecision::default();

        // 1. Exclude path -> Allow without token, 0 forwarded headers
        let path_health = b"/api/health";
        let st1 = unsafe {
            aurora_jwt_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path_health.as_ptr(),
                path_health.len(),
                ptr::null(),
                0,
                &mut decision,
            )
        };
        assert_eq!(st1, 0);
        assert_eq!(decision.allowed, 1);
        assert_eq!(decision.headers_count, 0);

        // 2. Protected path without token -> Unauthorized
        let path_orders = b"/api/orders";
        let st2 = unsafe {
            aurora_jwt_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path_orders.as_ptr(),
                path_orders.len(),
                ptr::null(),
                0,
                &mut decision,
            )
        };
        assert_eq!(st2, 0);
        assert_eq!(decision.allowed, 0);

        // 3. Protected path with valid token -> Allowed + Injected headers
        let claims = Claims {
            sub: "admin_user_42".to_string(),
            role: "admin".to_string(),
            exp: 2000000000,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        ).unwrap();
        let auth_hdr = format!("Bearer {token}");

        let st3 = unsafe {
            aurora_jwt_evaluate(
                engine_ptr,
                host.as_ptr(),
                host.len(),
                path_orders.as_ptr(),
                path_orders.len(),
                auth_hdr.as_ptr(),
                auth_hdr.len(),
                &mut decision,
            )
        };
        assert_eq!(st3, 0);
        assert_eq!(decision.allowed, 1);
        assert_eq!(decision.headers_count, 2);

        let h0_name = std::str::from_utf8(&decision.headers[0].name[..decision.headers[0].name_len as usize]).unwrap();
        let h0_val = std::str::from_utf8(&decision.headers[0].value[..decision.headers[0].value_len as usize]).unwrap();
        assert_eq!(h0_name, "X-User-Id");
        assert_eq!(h0_val, "admin_user_42");

        let h1_name = std::str::from_utf8(&decision.headers[1].name[..decision.headers[1].name_len as usize]).unwrap();
        let h1_val = std::str::from_utf8(&decision.headers[1].value[..decision.headers[1].value_len as usize]).unwrap();
        assert_eq!(h1_name, "X-User-Role");
        assert_eq!(h1_val, "admin");

        // Clean up
        unsafe { aurora_jwt_destroy(engine_ptr) };
    }
}
