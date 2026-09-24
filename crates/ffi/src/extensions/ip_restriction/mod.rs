use aurora_engine::{
    Decision,
    ip_restriction::{IpRestrictionEngine, IpRestrictionRequest},
};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
};

#[repr(C)]
pub struct IpRestrictionInput {
    pub ip: *const u8,
    pub ip_len: usize,
    pub host: *const u8,
    pub host_len: usize,
    pub path: *const u8,
    pub path_len: usize,
    pub method: *const u8,
    pub method_len: usize,
    pub now: u64,
}

pub type AccessInput = IpRestrictionInput;

/// # Safety
/// Input bytes must be readable and out must be writable for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_ip_restriction_create(
    data: *const u8,
    len: usize,
    out: *mut *mut IpRestrictionEngine,
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
        IpRestrictionEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
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
pub unsafe extern "C" fn aurora_ip_restriction_destroy(engine: *mut IpRestrictionEngine) {
    if !engine.is_null() {
        unsafe {
            drop(Box::from_raw(engine));
        }
    }
}

/// # Safety
/// The handle must be live, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_ip_restriction_generation(
    engine: *const IpRestrictionEngine,
) -> u64 {
    if !engine.is_null() {
        unsafe { (&*engine).generation() }
    } else {
        0
    }
}

/// # Safety
/// All non-null pointers and their declared byte ranges must be valid for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_ip_restriction_evaluate(
    engine: *const IpRestrictionEngine,
    input: *const IpRestrictionInput,
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
    if input.is_null() || engine.is_null() {
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
    match catch_unwind(AssertUnwindSafe(|| {
        let req = unsafe {
            IpRestrictionRequest {
                ip: slice::from_raw_parts(q.ip, q.ip_len),
                host: slice::from_raw_parts(q.host, q.host_len),
                path: slice::from_raw_parts(q.path, q.path_len),
                method: slice::from_raw_parts(q.method, q.method_len),
                now: q.now,
            }
        };

        unsafe { (&*engine).evaluate(req) }
    })) {
        Ok(Ok(d)) => {
            unsafe {
                *out = d;
            }
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}
