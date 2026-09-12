use aurora_engine::jwt::{JwtDecision, JwtEngine};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

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
    if data.is_null() || len == 0 || len > 65_536 {
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

/// Returns 0 for allow, 1 for an unauthenticated request, and 2 when the
/// engine cannot safely evaluate its inputs.
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
    {
        return 2;
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
        Ok(Ok(JwtDecision::Allow)) => 0,
        Ok(Ok(JwtDecision::Unauthorized)) => 1,
        Ok(Err(_)) | Err(_) => 2,
    }
}
