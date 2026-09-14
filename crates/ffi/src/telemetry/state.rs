use aurora_engine::telemetry::{
    GatewaySharedMetrics, SHM_DEFAULT_PATH, SHM_FALLBACK_PATH, SHM_SIZE_BYTES,
};
use std::ffi::CStr;
use std::fs::OpenOptions;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};

pub static TELEMETRY_RUNNING: AtomicBool = AtomicBool::new(false);
pub static TOTAL_EVALUATIONS: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_ALLOWED: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_BLOCKED: AtomicU64 = AtomicU64::new(0);
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

/// Initialize shared memory file for cross-process telemetry with Aurora Agent.
///
/// Tries `path` if provided, then `/dev/shm/aurora_gateway_telemetry.bin`, then `/tmp/...`.
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

    let candidates = if let Some(p) = target_path {
        vec![p, SHM_DEFAULT_PATH, SHM_FALLBACK_PATH]
    } else {
        vec![SHM_DEFAULT_PATH, SHM_FALLBACK_PATH]
    };

    for candidate in candidates {
        let file_res = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o666)
            .open(candidate);

        if let Ok(file) = file_res {
            let _ = file.set_len(SHM_SIZE_BYTES as u64);
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
    }
    false
}

/// # Safety
/// Called once in each worker before threads/requests; shared is a zeroed aligned
/// NGINX shared-zone allocation, active is ngx_stat_active. Both outlive
/// all worker threads. The supported adapter platform uses lock-free 64-bit atomics.
pub unsafe fn bind(shared: *mut AtomicU64, len: usize, active: *mut AtomicU64) -> bool {
    if shared.is_null()
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

// Single private accessor contains the shared-zone pointer safety contract.
// Slots: total, allow, block, owner PID, CPU bits, RAM bits, RPS bits, sample time.
pub fn shared_slot(index: usize) -> Option<&'static AtomicU64> {
    let ptr = SHARED.load(Ordering::Acquire);
    if ptr.is_null() || index >= 8 {
        None
    } else {
        Some(unsafe { &*ptr.add(index) })
    }
}

pub fn active_connections() -> Option<u64> {
    let ptr = ACTIVE.load(Ordering::Acquire);
    if ptr.is_null() {
        None
    } else {
        Some(unsafe { &*ptr }.load(Ordering::Relaxed))
    }
}

/// Ghi nhận 1 lượt đánh giá rule khi NGINX xử lý request (kèm action quyết định: 0=allow, 1=block).
#[inline]
pub fn record_evaluation(action: u32) {
    record_waf(action);
}

#[inline(always)]
pub fn record_request(status: u32, duration_ms: u64) {
    if let Some(m) = gateway_metrics() {
        m.record_http_request(status, duration_ms);
    }
}

#[inline(always)]
pub fn record_waf(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_waf(action);
    }

    if let Some(total) = shared_slot(0) {
        total.fetch_add(1, Ordering::Relaxed);
        if let Some(counter) = shared_slot(if action == 1 { 2 } else { 1 }) {
            counter.fetch_add(1, Ordering::Relaxed);
        }
        return;
    }
    TOTAL_EVALUATIONS.fetch_add(1, Ordering::Relaxed);
    if action == 1 {
        TOTAL_BLOCKED.fetch_add(1, Ordering::Relaxed);
    } else {
        TOTAL_ALLOWED.fetch_add(1, Ordering::Relaxed);
    }
}

#[inline(always)]
pub fn record_access(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_access(action);
    }
}

#[inline(always)]
pub fn record_ratelimit(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ratelimit(action);
    }
}

#[inline(always)]
pub fn record_jwt(status: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_jwt(status);
    }
}

#[inline(always)]
pub fn record_conn_limit(blocked: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_conn_limit(blocked);
    }
}

#[inline(always)]
pub fn record_traffic_shaper(delayed: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_shaper(delayed);
    }
}

#[inline(always)]
pub fn record_request_size(rejected: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_request_size(rejected);
    }
}

#[inline(always)]
pub fn record_termination() {
    if let Some(m) = gateway_metrics() {
        m.record_termination();
    }
}

#[inline(always)]
pub fn record_traffic_split(secondary: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_split(secondary);
    }
}

#[inline(always)]
pub fn record_canary(is_canary: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_canary(is_canary);
    }
}

#[inline(always)]
pub fn record_blue_green(is_green: bool) {
    if let Some(m) = gateway_metrics() {
        m.record_blue_green(is_green);
    }
}

#[inline(always)]
pub fn record_mirror() {
    if let Some(m) = gateway_metrics() {
        m.record_mirror();
    }
}

#[inline(always)]
pub fn record_connections(active: u64, reading: u64, writing: u64, waiting: u64) {
    if let Some(m) = gateway_metrics() {
        m.record_connections(active, reading, writing, waiting);
    }
}
