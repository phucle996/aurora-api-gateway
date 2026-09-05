//! ABI v3: borrowed input buffers, owned immutable engine handles.
use aurora_engine::{Decision, Engine, MAX_PATH_BYTES, MAX_POLICY_BYTES};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};
const OK: u32 = 0;
const INVALID: u32 = 1;
const PANIC: u32 = 2;

// SAFETY: Unique Aurora symbol, with a fixed C signature.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_abi_version() -> u32 {
    3
}

/// # Safety
/// Handle must be live, path readable for len, out writable/aligned. No concurrent
/// destroy. Results contain only values; no allocation crosses the boundary.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_evaluate_v3(
    engine: *const Engine,
    path: *const u8,
    len: usize,
    out: *mut Decision,
) -> u32 {
    if out.is_null() {
        return INVALID;
    }
    unsafe {
        *out = Decision {
            action: 1,
            ..Decision::default()
        };
    }
    if engine.is_null() || path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        (&*engine).evaluate(slice::from_raw_parts(path, len))
    })) {
        Ok(Ok(decision)) => {
            unsafe {
                *out = decision;
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// # Safety
/// engine must be live, with no concurrent destroy. Null returns generation zero.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_generation(engine: *const Engine) -> u64 {
    if engine.is_null() {
        return 0;
    }
    unsafe { (&*engine).generation() }
}

/// # Safety
/// out must be writable/aligned; data must contain len readable bytes for this
/// call. Destroy a successful handle exactly once. Input is copied, never retained.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_create(
    data: *const u8,
    len: usize,
    out: *mut *mut Engine,
) -> u32 {
    if out.is_null() {
        return INVALID;
    }
    unsafe {
        *out = ptr::null_mut();
    }
    if data.is_null() || len == 0 || len > MAX_POLICY_BYTES {
        return INVALID;
    }
    match catch_unwind(|| {
        Engine::from_policy(unsafe { slice::from_raw_parts(data, len) })
            .map(|e| Box::into_raw(Box::new(e)))
    }) {
        Ok(Ok(engine)) => {
            unsafe {
                *out = engine;
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// # Safety
/// Handle must be live; path readable for len; action writable/aligned.
/// No concurrent destroy. Request buffers are never retained.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_evaluate(
    engine: *const Engine,
    path: *const u8,
    len: usize,
    action: *mut u32,
) -> u32 {
    if action.is_null() {
        return INVALID;
    }
    unsafe {
        *action = 1;
    }
    if engine.is_null() || path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        (&*engine).blocked(slice::from_raw_parts(path, len))
    })) {
        Ok(Ok(blocked)) => {
            unsafe {
                *action = u32::from(blocked);
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// # Safety
/// Null accepted; otherwise handle must originate from create, still live, with
/// no concurrent evaluations. No access or second destroy after return.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_destroy(engine: *mut Engine) {
    if !engine.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            drop(Box::from_raw(engine));
        }));
    }
}
