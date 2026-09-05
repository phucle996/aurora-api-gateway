use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};

pub static TELEMETRY_RUNNING: AtomicBool = AtomicBool::new(false);
pub static TOTAL_EVALUATIONS: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_ALLOWED: AtomicU64 = AtomicU64::new(0);
pub static TOTAL_BLOCKED: AtomicU64 = AtomicU64::new(0);
static SHARED: AtomicPtr<AtomicU64> = AtomicPtr::new(std::ptr::null_mut());
static ACTIVE: AtomicPtr<AtomicU64> = AtomicPtr::new(std::ptr::null_mut());

/// # Safety
/// Called once in each worker before threads/requests; shared is a zeroed aligned
/// 64-byte NGINX shared-zone allocation, active is ngx_stat_active. Both outlive
/// all worker threads. The supported adapter platform uses lock-free 64-bit atomics.
pub unsafe fn bind(shared: *mut AtomicU64, len: usize, active: *mut AtomicU64) -> bool {
    if len != 64
        || shared.is_null()
        || active.is_null()
        || !(shared as usize).is_multiple_of(8)
        || !(active as usize).is_multiple_of(8)
    {
        return false;
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
