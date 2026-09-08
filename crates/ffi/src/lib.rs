//! Aurora WAF FFI - Lớp cầu nối giao tiếp C ABI (C Foreign Function Interface).
//!
//! Vai trò kiến trúc:
//! - Xuất các hàm Rust theo chuẩn C ABI (`extern "C"` với `#[no_mangle]`) để module NGINX viết bằng C
//!   có thể trực tiếp nhúng và gọi hàm của Engine mà không cần thông qua mạng hoặc socket.
//! - Thiết kế ABI v3: Sử dụng bộ đệm vay mượn (borrowed input buffers), dữ liệu trả về kiểu giá trị (value-only struct),
//!   và con trỏ đối tượng Engine bất biến (owned immutable engine handles).
//! - Bọc toàn bộ các lời gọi bằng `catch_unwind` để đảm bảo nếu Rust xảy ra panic thì
//!   tuyệt đối không bị rò rỉ ra ngoài C làm sập tiến trình NGINX.

use aurora_engine::{Decision, Engine, MAX_PATH_BYTES, MAX_POLICY_BYTES};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

pub mod access;
pub mod telemetry;
pub mod upstream;

pub static DYNAMIC_POLICY_ENGINE: std::sync::RwLock<Option<std::sync::Arc<Engine>>> =
    std::sync::RwLock::new(None);

/// Mã trạng thái trả về cho caller C:
/// - OK (0): Thao tác thành công
const OK: u32 = 0;
/// - INVALID (1): Tham số đầu vào không hợp lệ hoặc dữ liệu chính sách bị lỗi
const INVALID: u32 = 1;
/// - PANIC (2): Quá trình xử lý phía Rust bị panic nhưng đã được chặn lại an toàn
const PANIC: u32 = 2;

/// Trả về số phiên bản ABI hiện tại của Aurora WAF (hiện tại là 3).
/// Module NGINX sẽ gọi hàm này lúc khởi động để kiểm tra tính tương thích nhị phân.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_abi_version() -> u32 {
    3
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
    // Bước 1: Kiểm tra con trỏ đầu ra out có hợp lệ không
    if out.is_null() {
        return INVALID;
    }

    // Gán con trỏ đầu ra ban đầu về null để đảm bảo an toàn nếu gặp lỗi giữa chừng
    unsafe {
        *out = ptr::null_mut();
    }

    // Bước 2: Kiểm tra dữ liệu đầu vào: không null, không rỗng và không vượt quá 64KB
    if data.is_null() || len == 0 || len > MAX_POLICY_BYTES {
        return INVALID;
    }

    // Bước 3: Gọi Engine::from_policy bên trong khối catch_unwind để ngăn panic tràn sang C
    match catch_unwind(|| {
        Engine::from_policy(unsafe { slice::from_raw_parts(data, len) })
            .map(|e| Box::into_raw(Box::new(e))) // Đưa Engine lên Heap và chuyển thành con trỏ thô (raw pointer)
    }) {
        // Khởi tạo thành công: gán con trỏ Engine vào *out và trả về mã OK (0)
        Ok(Ok(engine)) => {
            unsafe {
                *out = engine;
            }
            OK
        }
        // Dữ liệu chính sách JSON không hợp lệ: trả về mã INVALID (1)
        Ok(Err(_)) => INVALID,
        // Bắt được panic từ Rust: trả về mã PANIC (2) mà không làm sập NGINX
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
            telemetry::record_evaluation(decision.action);
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
            telemetry::record_evaluation(decision.action);
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
    // Giá trị an toàn mặc định là Block (1)
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
            telemetry::record_evaluation(act);
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
        // Tái tạo lại Box từ con trỏ thô để bộ thu dọn bộ nhớ của Rust tự động drop giải phóng
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            drop(Box::from_raw(engine));
        }));
    }
}

/// Khởi chạy In-Process Runtime Thread (Đồng bộ Policy/Access, In-memory Hot-swap, Flush Match events và Heartbeat).
///
/// # Safety
/// Các con trỏ chuỗi C phải kết thúc bằng '\0' hoặc là null pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_start_runtime(
    controller_url: *const std::ffi::c_char,
    node_id: *const std::ffi::c_char,
    token: *const std::ffi::c_char,
    interval_seconds: u32,
    active_release_id: i64,
    policy_path: *const std::ffi::c_char,
    access_path: *const std::ffi::c_char,
    is_leader: u32,
) -> u32 {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let url = if !controller_url.is_null() {
            unsafe {
                std::ffi::CStr::from_ptr(controller_url)
                    .to_string_lossy()
                    .to_string()
            }
        } else {
            std::env::var("AURORA_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into())
        };

        let nid = if !node_id.is_null() {
            unsafe {
                std::ffi::CStr::from_ptr(node_id)
                    .to_string_lossy()
                    .to_string()
            }
        } else {
            std::env::var("AURORA_NODE_ID").unwrap_or_else(|_| "node-local-01".into())
        };

        let tok = if !token.is_null() {
            unsafe {
                std::ffi::CStr::from_ptr(token)
                    .to_string_lossy()
                    .to_string()
            }
        } else {
            std::env::var("AURORA_AUTH_TOKEN").unwrap_or_default()
        };

        let interval = if interval_seconds > 0 {
            interval_seconds
        } else {
            std::env::var("AURORA_HEARTBEAT_INTERVAL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(5)
        };

        let pol_file = if !policy_path.is_null() {
            unsafe {
                std::ffi::CStr::from_ptr(policy_path)
                    .to_string_lossy()
                    .to_string()
            }
        } else {
            std::env::var("AURORA_POLICY_PATH").unwrap_or_default()
        };

        let acc_file = if !access_path.is_null() {
            unsafe {
                std::ffi::CStr::from_ptr(access_path)
                    .to_string_lossy()
                    .to_string()
            }
        } else {
            std::env::var("AURORA_ACCESS_POLICY_PATH").unwrap_or_default()
        };

        telemetry::start_runtime(
            &url,
            &nid,
            &tok,
            interval,
            active_release_id,
            &pol_file,
            &acc_file,
            is_leader != 0,
        );
    }));
    OK
}

/// Khởi chạy Background Telemetry Thread từ NGINX Worker 0 (backward compatibility).
///
/// # Safety
/// - `controller_url`, `node_id`, `token` là chuỗi C kết thúc bằng null ('\0') hoặc null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_start_telemetry(
    controller_url: *const std::ffi::c_char,
    node_id: *const std::ffi::c_char,
    token: *const std::ffi::c_char,
    interval_seconds: u32,
    active_release_id: i64,
) -> u32 {
    unsafe {
        aurora_waf_start_runtime(
            controller_url,
            node_id,
            token,
            interval_seconds,
            active_release_id,
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    }
}

/// Dừng Background Telemetry Thread khi NGINX Worker tắt.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_stop_telemetry() {
    let _ = catch_unwind(AssertUnwindSafe(telemetry::stop_telemetry));
}

/// Bind adapter-owned shared telemetry counters before starting worker threads.
/// # Safety
/// See telemetry::bind: both aligned allocations must outlive the worker.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_bind_telemetry(
    shared: *mut std::ffi::c_void,
    len: usize,
    active: *mut std::ffi::c_void,
) -> u32 {
    if unsafe { telemetry::bind(shared.cast(), len, active.cast()) } {
        OK
    } else {
        1
    }
}

/// Xuất chuỗi định dạng văn bản Prometheus / OpenMetrics phục vụ endpoint /metrics của NGINX.
///
/// # Safety
/// - `node_id`: Chuỗi C string tên node (hoặc null).
/// - `out_buf`: Vùng nhớ đệm nhận dữ liệu chuỗi.
/// - `max_len`: Kích thước tối đa của `out_buf`.
/// - `written_len`: Con trỏ nhận số byte thực tế đã ghi.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_format_prometheus_metrics(
    node_id: *const std::ffi::c_char,
    out_buf: *mut u8,
    max_len: usize,
    written_len: *mut usize,
) -> u32 {
    if out_buf.is_null() || written_len.is_null() || max_len == 0 {
        return INVALID;
    }

    let _ = catch_unwind(AssertUnwindSafe(|| {
        let nid = if !node_id.is_null() {
            unsafe { std::ffi::CStr::from_ptr(node_id).to_str().unwrap_or("") }
        } else {
            ""
        };

        let metrics_text = telemetry::format_prometheus_metrics(nid);
        let bytes = metrics_text.as_bytes();
        let copy_len = bytes.len().min(max_len);

        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), out_buf, copy_len);
            *written_len = copy_len;
        }
    }));

    OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access::{
        AccessInput, aurora_access_evaluate, aurora_access_generation, aurora_access_record_match,
        aurora_access_swap_engine, drain_access_matches,
    };

    #[test]
    fn test_dynamic_access_hot_swap_and_match_buffer() {
        let snapshot_json = br#"{"schema_version":1,"generation":42,"rules":[{"id":101,"priority":1,"action":"block","networks":["192.168.1.0/24"],"host":"*","path_prefix":"/api","method":"*","schedule":"always","expires_at":0,"log":true,"reputation":false,"alert":false}]}"#;

        let ret = unsafe { aurora_access_swap_engine(snapshot_json.as_ptr(), snapshot_json.len()) };
        assert_eq!(ret, 0);

        let generation = unsafe { aurora_access_generation(std::ptr::null()) };
        assert_eq!(generation, 42);

        // Evaluate request against hot-swapped engine in RAM (without static engine handle)
        let ip = b"192.168.1.50";
        let host = b"example.com";
        let path = b"/api/v1/resource";
        let method = b"GET";
        let input = AccessInput {
            ip: ip.as_ptr(),
            ip_len: ip.len(),
            host: host.as_ptr(),
            host_len: host.len(),
            path: path.as_ptr(),
            path_len: path.len(),
            method: method.as_ptr(),
            method_len: method.len(),
            now: 1000,
        };
        let mut decision = Decision::default();
        let eval_status = unsafe { aurora_access_evaluate(std::ptr::null(), &input, &mut decision) };
        assert_eq!(eval_status, 0);
        assert_eq!(decision.action, 1); // blocked
        assert_eq!(decision.rule_id, 101);
        assert_eq!(decision.generation, 42);
        assert_eq!(decision.log_matches, 1);

        // Verify match event was automatically enqueued in RAM
        let matches = drain_access_matches(10);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].release_id, 42);
        assert_eq!(matches[0].rule_id, 101);
        assert_eq!(matches[0].ip, "192.168.1.50");

        // Explicit match record C ABI
        let explicit_ip = b"10.0.0.99";
        let rec_status = unsafe {
            aurora_access_record_match(42, 999, explicit_ip.as_ptr(), explicit_ip.len())
        };
        assert_eq!(rec_status, 0);
        let explicit_matches = drain_access_matches(10);
        assert_eq!(explicit_matches.len(), 1);
        assert_eq!(explicit_matches[0].rule_id, 999);
        assert_eq!(explicit_matches[0].ip, "10.0.0.99");
    }

    #[test]
    fn test_dynamic_policy_hot_swap() {
        let policy_json = br#"{"schema_version":1,"block_paths":["/admin","/restricted"]}"#;
        let ret = unsafe { aurora_waf_swap_policy(policy_json.as_ptr(), policy_json.len()) };
        assert_eq!(ret, 0);

        let path = b"/admin";
        let mut decision = Decision::default();
        let status = unsafe {
            aurora_waf_evaluate_v3(std::ptr::null(), path.as_ptr(), path.len(), &mut decision)
        };
        assert_eq!(status, 0);
        assert_eq!(decision.action, 1); // Blocked

        let safe_path = b"/public/index.html";
        let mut safe_decision = Decision::default();
        let safe_status = unsafe {
            aurora_waf_evaluate_v3(
                std::ptr::null(),
                safe_path.as_ptr(),
                safe_path.len(),
                &mut safe_decision,
            )
        };
        assert_eq!(safe_status, 0);
        assert_eq!(safe_decision.action, 0); // Allowed
    }
}
