//! Shared Memory Substrate (C ABI Layer)
//!
//! Exposes shared memory initialization and memory mapping for NGINX worker processes.
//! Subdivided into:
//! - `metrics`: Core HTTP & connection metrics recording.
//! - `logs`: Dynamic log gating & consumer tracking.

pub mod logs;
pub mod metrics;

pub use logs::*;
pub use metrics::*;

use aurora_engine::shm::{GatewaySharedMetrics, SHM_DEFAULT_PATH, SHM_SIZE_BYTES};
use std::ffi::CStr;
use std::fs::OpenOptions;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};

pub static SHM_RUNNING: AtomicBool = AtomicBool::new(false);
static SHARED: AtomicPtr<AtomicU64> = AtomicPtr::new(std::ptr::null_mut());
static ACTIVE: AtomicPtr<AtomicU64> = AtomicPtr::new(std::ptr::null_mut());
static GATEWAY_METRICS: AtomicPtr<GatewaySharedMetrics> = AtomicPtr::new(std::ptr::null_mut());

/// Retrieve global GatewaySharedMetrics reference if bound.
#[inline(always)]
pub fn gateway_metrics() -> Option<&'static GatewaySharedMetrics> {
    let ptr = GATEWAY_METRICS.load(Ordering::Acquire);
    if ptr.is_null() {
        None
    } else {
        Some(unsafe { &*ptr })
    }
}

pub fn shared_slot(index: usize) -> Option<&'static AtomicU64> {
    let ptr = SHARED.load(Ordering::Acquire);
    if ptr.is_null() || index >= 8 {
        None
    } else {
        Some(unsafe { &*ptr.add(index) })
    }
}

pub fn stop_shm() {
    SHM_RUNNING.store(false, Ordering::SeqCst);
}

/// Initialize shared memory file for cross-process telemetry with Aurora Agent.
///
/// # Safety
/// If `path` is non-null, it must point to a valid null-terminated C string.
pub unsafe fn init_shm(path: *const std::ffi::c_char) -> bool {
    let target_path = if !path.is_null() {
        if let Ok(s) = unsafe { CStr::from_ptr(path).to_str() } {
            if !s.is_empty() { Some(s) } else { None }
        } else {
            None
        }
    } else {
        None
    };

    let target = target_path.unwrap_or(SHM_DEFAULT_PATH);

    let file_res = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o666)
        .open(target);

    if let Ok(file) = file_res {
        let _ = file.set_len(SHM_SIZE_BYTES as u64);
        let _ = file.set_permissions(std::fs::Permissions::from_mode(0o666));
        let fd = file.as_raw_fd();
        let mmap_ptr = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                SHM_SIZE_BYTES,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd,
                0,
            )
        };

        if mmap_ptr != libc::MAP_FAILED && !mmap_ptr.is_null() {
            let metrics_ptr = mmap_ptr as *mut GatewaySharedMetrics;
            unsafe {
                (*metrics_ptr).ensure_header();
            }
            GATEWAY_METRICS.store(metrics_ptr, Ordering::Release);
            SHARED.store(mmap_ptr as *mut AtomicU64, Ordering::Release);
            return true;
        }
    }
    false
}

/// # Safety
/// Called once in each worker before threads/requests; shared is a zeroed aligned
/// NGINX shared-zone allocation, active is ngx_stat_active. Both outlive
/// all worker threads.
pub unsafe fn bind(shared: *mut AtomicU64, len: usize, active: *mut AtomicU64) -> bool {
    if len < 64
        || shared.is_null()
        || active.is_null()
        || !(shared as usize).is_multiple_of(8)
        || !(active as usize).is_multiple_of(8)
    {
        return false;
    }

    if len >= SHM_SIZE_BYTES {
        let metrics_ptr = shared as *mut GatewaySharedMetrics;
        unsafe {
            (*metrics_ptr).ensure_header();
        }
        GATEWAY_METRICS.store(metrics_ptr, Ordering::Release);
    }

    SHARED.store(shared, Ordering::Release);
    ACTIVE.store(active, Ordering::Release);
    true
}

// C ABI Bindings
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_init_shm(path: *const std::ffi::c_char) -> u32 {
    if unsafe { init_shm(path) } { 0 } else { 1 }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_bind_shm(
    shared: *mut std::ffi::c_void,
    len: usize,
    active: *mut std::ffi::c_void,
) -> u32 {
    if unsafe { bind(shared.cast(), len, active.cast()) } {
        0
    } else {
        1
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_stop_shm() {
    stop_shm();
}
