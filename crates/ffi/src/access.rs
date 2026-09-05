use aurora_engine::{
    Decision,
    access::{AccessEngine, AccessRequest},
};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
};

#[repr(C)]
pub struct AccessInput {
    ip: *const u8,
    ip_len: usize,
    host: *const u8,
    host_len: usize,
    path: *const u8,
    path_len: usize,
    method: *const u8,
    method_len: usize,
    now: u64,
}
/// # Safety
/// Input bytes must be readable and out must be writable for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_create(
    data: *const u8,
    len: usize,
    out: *mut *mut AccessEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe {
        *out = std::ptr::null_mut();
    }
    if data.is_null() || len == 0 || len > 65536 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        AccessEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
    })) {
        Ok(Ok(e)) => {
            unsafe {
                *out = Box::into_raw(Box::new(e));
            }
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}
/// # Safety
/// The handle must be live, or null. Destroy it exactly once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_destroy(engine: *mut AccessEngine) {
    if !engine.is_null() {
        unsafe {
            drop(Box::from_raw(engine));
        }
    }
}
/// # Safety
/// The handle must be live, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_generation(engine: *const AccessEngine) -> u64 {
    if engine.is_null() {
        0
    } else {
        unsafe { (&*engine).generation() }
    }
}
/// # Safety
/// All non-null pointers and their declared byte ranges must be valid for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_evaluate(
    engine: *const AccessEngine,
    input: *const AccessInput,
    out: *mut Decision,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe {
        *out = Decision {
            action: 1,
            ..Default::default()
        };
    }
    if engine.is_null() || input.is_null() {
        return 1;
    }
    let q = unsafe { &*input };
    for (p, len, max) in [
        (q.ip, q.ip_len, 45),
        (q.host, q.host_len, 253),
        (q.path, q.path_len, 8192),
        (q.method, q.method_len, 16),
    ] {
        if p.is_null() || len == 0 || len > max {
            return 1;
        }
    }
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        (&*engine).evaluate(AccessRequest {
            ip: slice::from_raw_parts(q.ip, q.ip_len),
            host: slice::from_raw_parts(q.host, q.host_len),
            path: slice::from_raw_parts(q.path, q.path_len),
            method: slice::from_raw_parts(q.method, q.method_len),
            now: q.now,
        })
    })) {
        Ok(Ok(d)) => {
            if d.action == 1 {
                crate::telemetry::record_evaluation(1);
            }
            unsafe {
                *out = d;
            }
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}
