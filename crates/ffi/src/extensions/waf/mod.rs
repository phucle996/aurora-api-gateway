//! Aurora Core WAF Extension C ABI.

use aurora_engine::{Decision, Engine, MAX_PATH_BYTES, MAX_POLICY_BYTES};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

pub static DYNAMIC_POLICY_ENGINE: std::sync::RwLock<Option<std::sync::Arc<Engine>>> =
    std::sync::RwLock::new(None);

/// Mã trạng thái trả về cho caller C:
/// - OK (0): Thao tác thành công
const OK: u32 = 0;
/// - INVALID (1): Tham số đầu vào không hợp lệ hoặc dữ liệu chính sách bị lỗi
const INVALID: u32 = 1;
/// - PANIC (2): Quá trình xử lý phía Rust bị panic nhưng đã được chặn lại an toàn
const PANIC: u32 = 2;

/// Trả về số phiên bản ABI hiện tại của Aurora WAF (hiện tại là 4).
/// Module NGINX sẽ gọi hàm này lúc khởi động để kiểm tra tính tương thích nhị phân.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_abi_version() -> u32 {
    4
}

/// Nạp và hoán đổi nguyên tử (Atomic Swap) Policy Engine mới vào RAM.
/// # Safety
/// `data` phải trỏ tới vùng nhớ hợp lệ chứa chuỗi JSON policy.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_swap_policy(data: *const u8, len: usize) -> u32 {
    if data.is_null() || len == 0 || len > MAX_POLICY_BYTES {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        let bytes = unsafe { slice::from_raw_parts(data, len) };
        Engine::from_policy(bytes)
    })) {
        Ok(Ok(e)) => {
            if let Ok(mut g) = DYNAMIC_POLICY_ENGINE.write() {
                *g = Some(std::sync::Arc::new(e));
                OK
            } else {
                INVALID
            }
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// Tạo mới một đối tượng Engine từ dữ liệu chuỗi byte JSON chính sách (Policy data).
///
/// # Safety
/// - Con trỏ `data` phải hợp lệ và có thể đọc được `len` bytes.
/// - Con trỏ `out` phải trỏ tới vùng nhớ hợp lệ có thể ghi con trỏ `*mut Engine`.
/// - Khi không còn sử dụng, con trỏ Engine trả về phải được giải phóng đúng 1 lần qua hàm `aurora_waf_destroy`.
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

/// Đánh giá một đường dẫn URL theo chuẩn ABI v3, ghi kết quả trực tiếp vào struct Decision.
///
/// # Safety
/// - `engine`: Phải là con trỏ còn sống được tạo từ `aurora_waf_create`.
/// - `path`: Vùng nhớ hợp lệ có thể đọc `len` bytes.
/// - `out`: Vùng nhớ hợp lệ có thể ghi struct `Decision`.
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

    if path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let path_slice = unsafe { slice::from_raw_parts(path, len) };
        let dynamic_arc = DYNAMIC_POLICY_ENGINE.read().ok().and_then(|g| g.clone());
        if let Some(dyn_eng) = dynamic_arc {
            dyn_eng.evaluate(path_slice)
        } else if !engine.is_null() {
            unsafe { (&*engine).evaluate(path_slice) }
        } else {
            Err(aurora_engine::Error::InvalidPolicy)
        }
    })) {
        Ok(Ok(decision)) => {
            crate::telemetry::record_evaluation(decision.action);
            unsafe {
                *out = decision;
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// Host-aware evaluation; existing value-only Decision layout is unchanged.
/// # Safety
/// Engine and nonempty input buffers must be valid for the call; out must be writable.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_evaluate_v4(
    engine: *const Engine,
    host: *const u8,
    host_len: usize,
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
    if path.is_null()
        || len == 0
        || len > MAX_PATH_BYTES
        || host_len > 253
        || (host_len > 0 && host.is_null())
    {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        let host_slice = if host_len == 0 {
            &[]
        } else {
            unsafe { slice::from_raw_parts(host, host_len) }
        };
        let path_slice = unsafe { slice::from_raw_parts(path, len) };
        let dynamic_arc = DYNAMIC_POLICY_ENGINE.read().ok().and_then(|g| g.clone());
        if let Some(dyn_eng) = dynamic_arc {
            dyn_eng.evaluate_request(host_slice, path_slice)
        } else if !engine.is_null() {
            unsafe { (&*engine).evaluate_request(host_slice, path_slice) }
        } else {
            Err(aurora_engine::Error::InvalidPolicy)
        }
    })) {
        Ok(Ok(decision)) => {
            crate::telemetry::record_evaluation(decision.action);
            unsafe {
                *out = decision;
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// Lấy số thế hệ (generation) của chính sách đang được Engine áp dụng.
///
/// # Safety
/// - `engine`: Con trỏ Engine còn sống. Nếu truyền con trỏ null sẽ trả về 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_generation(engine: *const Engine) -> u64 {
    if let Ok(guard) = DYNAMIC_POLICY_ENGINE.read()
        && let Some(dyn_eng) = guard.as_ref()
    {
        dyn_eng.generation()
    } else if !engine.is_null() {
        unsafe { (&*engine).generation() }
    } else {
        0
    }
}

/// Đánh giá đường dẫn URL theo chuẩn ABI cũ (chỉ kiểm tra trạng thái chặn 0 hoặc 1).
///
/// # Safety
/// - `action`: Con trỏ ghi giá trị số nguyên: 0 là Allow, 1 là Block.
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
    if path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        let path_slice = unsafe { slice::from_raw_parts(path, len) };
        let dynamic_arc = DYNAMIC_POLICY_ENGINE.read().ok().and_then(|g| g.clone());
        if let Some(dyn_eng) = dynamic_arc {
            dyn_eng.blocked(path_slice)
        } else if !engine.is_null() {
            unsafe { (&*engine).blocked(path_slice) }
        } else {
            Err(aurora_engine::Error::InvalidPolicy)
        }
    })) {
        Ok(Ok(blocked)) => {
            let act = u32::from(blocked);
            crate::telemetry::record_evaluation(act);
            unsafe {
                *action = act;
            }
            OK
        }
        Ok(Err(_)) => INVALID,
        Err(_) => PANIC,
    }
}

/// Thu hồi và giải phóng bộ nhớ của đối tượng Engine khi NGINX reload hoặc shutdown.
///
/// # Safety
/// - Chấp nhận con trỏ null (không làm gì).
/// - Nếu khác null: phải là con trỏ hợp lệ được cấp phát từ `aurora_waf_create` và chưa từng bị giải phóng trước đó.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_destroy(engine: *mut Engine) {
    if !engine.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            drop(Box::from_raw(engine));
        }));
    }
}
