use aurora_engine::{
    Decision,
    access::{AccessEngine, AccessRequest},
};
use std::{
    collections::VecDeque,
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
    sync::{Arc, Mutex, RwLock, atomic::{AtomicU64, Ordering}},
    time::{SystemTime, UNIX_EPOCH},
};

/// Dynamic in-memory Access Engine maintained by background sync thread in NGINX Worker.
pub static DYNAMIC_ACCESS_ENGINE: RwLock<Option<Arc<AccessEngine>>> = RwLock::new(None);

#[derive(Clone, Debug)]
pub struct AccessMatchItem {
    pub key: String,
    pub release_id: i64,
    pub rule_id: i64,
    pub ip: String,
}

pub static MATCH_QUEUE: Mutex<VecDeque<AccessMatchItem>> = Mutex::new(VecDeque::new());
static MATCH_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn enqueue_access_match(release_id: i64, rule_id: i64, ip: &str) {
    if ip.is_empty() {
        return;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seq = MATCH_SEQ.fetch_add(1, Ordering::Relaxed);
    let key = format!("{}:{}:{}", now.as_millis(), std::process::id(), seq);

    if let Ok(mut q) = MATCH_QUEUE.lock() {
        if q.len() < 5000 {
            q.push_back(AccessMatchItem {
                key,
                release_id,
                rule_id,
                ip: ip.to_string(),
            });
        }
    }
}

pub fn drain_access_matches(max: usize) -> Vec<AccessMatchItem> {
    if let Ok(mut q) = MATCH_QUEUE.lock() {
        if q.is_empty() {
            Vec::new()
        } else {
            let count = q.len().min(max);
            q.drain(..count).collect()
        }
    } else {
        Vec::new()
    }
}

#[repr(C)]
pub struct AccessInput {
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
    if let Ok(guard) = DYNAMIC_ACCESS_ENGINE.read()
        && let Some(dyn_eng) = guard.as_ref()
    {
        dyn_eng.generation()
    } else if !engine.is_null() {
        unsafe { (&*engine).generation() }
    } else {
        0
    }
}

/// Ghi nhận thủ công một sự kiện Access Match vào hàng đợi RAM.
/// # Safety
/// `ip` phải trỏ tới vùng nhớ hợp lệ chứa `ip_len` byte.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_record_match(
    generation: u64,
    rule_id: u64,
    ip: *const u8,
    ip_len: usize,
) -> u32 {
    if ip.is_null() || ip_len == 0 || ip_len > 45 {
        return 1;
    }
    let ip_bytes = unsafe { slice::from_raw_parts(ip, ip_len) };
    if let Ok(ip_str) = std::str::from_utf8(ip_bytes) {
        enqueue_access_match(generation as i64, rule_id as i64, ip_str);
        0
    } else {
        1
    }
}

/// Nạp và hoán đổi nguyên tử (Atomic Swap) Access Engine mới vào RAM.
/// # Safety
/// `data` phải trỏ tới vùng nhớ hợp lệ chứa snapshot JSON của access release.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_access_swap_engine(data: *const u8, len: usize) -> u32 {
    if data.is_null() || len == 0 || len > 65536 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        let bytes = unsafe { slice::from_raw_parts(data, len) };
        AccessEngine::from_snapshot(bytes)
    })) {
        Ok(Ok(e)) => {
            if let Ok(mut g) = DYNAMIC_ACCESS_ENGINE.write() {
                *g = Some(Arc::new(e));
                0
            } else {
                1
            }
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
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
    if input.is_null() {
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
            AccessRequest {
                ip: slice::from_raw_parts(q.ip, q.ip_len),
                host: slice::from_raw_parts(q.host, q.host_len),
                path: slice::from_raw_parts(q.path, q.path_len),
                method: slice::from_raw_parts(q.method, q.method_len),
                now: q.now,
            }
        };

        let dynamic_arc = DYNAMIC_ACCESS_ENGINE.read().ok().and_then(|g| g.clone());
        if let Some(dyn_eng) = dynamic_arc {
            dyn_eng.evaluate(req)
        } else if !engine.is_null() {
            unsafe { (&*engine).evaluate(req) }
        } else {
            Err(aurora_engine::Error::InvalidPolicy)
        }
    })) {
        Ok(Ok(d)) => {
            if d.action == 1 {
                crate::telemetry::record_evaluation(1);
            }
            if d.log_matches != 0 {
                let ip_str = unsafe {
                    std::str::from_utf8(slice::from_raw_parts(q.ip, q.ip_len)).unwrap_or("")
                };
                enqueue_access_match(d.generation as i64, d.rule_id as i64, ip_str);
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

