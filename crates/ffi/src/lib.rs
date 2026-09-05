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

pub mod telemetry;

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
    // Bước 1: Kiểm tra con trỏ đầu ra
    if out.is_null() {
        return INVALID;
    }

    // Thiết lập giá trị phòng ngừa ban đầu theo nguyên tắc Fail-Closed (mặc định action = 1 tức Block)
    // Nếu có lỗi xảy ra giữa chừng, request sẽ tự động bị chặn để đảm bảo an toàn
    unsafe {
        *out = Decision {
            action: 1,
            ..Decision::default()
        };
    }

    // Bước 2: Kiểm tra tính hợp lệ của con trỏ engine và dữ liệu đường dẫn
    if engine.is_null() || path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }

    // Bước 3: Gọi hàm evaluate của Engine trong khối bọc an toàn catch_unwind
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        (&*engine).evaluate(slice::from_raw_parts(path, len))
    })) {
        // So khớp thành công: ghi kết quả Decision vào *out và trả về mã OK (0)
        Ok(Ok(decision)) => {
            telemetry::record_evaluation(decision.action);
            unsafe {
                *out = decision;
            }
            OK
        }
        // Đường dẫn URL không hợp lệ: trả về mã INVALID (1)
        Ok(Err(_)) => INVALID,
        // Bắt được panic: trả về mã PANIC (2)
        Err(_) => PANIC,
    }
}

/// Lấy số thế hệ (generation) của chính sách đang được Engine áp dụng.
///
/// # Safety
/// - `engine`: Con trỏ Engine còn sống. Nếu truyền con trỏ null sẽ trả về 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_generation(engine: *const Engine) -> u64 {
    if engine.is_null() {
        return 0;
    }
    unsafe { (&*engine).generation() }
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
    if engine.is_null() || path.is_null() || len == 0 || len > MAX_PATH_BYTES {
        return INVALID;
    }
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        (&*engine).blocked(slice::from_raw_parts(path, len))
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

/// Khởi chạy Background Telemetry Thread từ NGINX Worker 0.
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
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let url = if !controller_url.is_null() {
            unsafe { std::ffi::CStr::from_ptr(controller_url).to_string_lossy().to_string() }
        } else {
            std::env::var("AURORA_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into())
        };

        let nid = if !node_id.is_null() {
            unsafe { std::ffi::CStr::from_ptr(node_id).to_string_lossy().to_string() }
        } else {
            std::env::var("AURORA_NODE_ID").unwrap_or_else(|_| "node-local-01".into())
        };

        let tok = if !token.is_null() {
            unsafe { std::ffi::CStr::from_ptr(token).to_string_lossy().to_string() }
        } else {
            std::env::var("AURORA_AUTH_TOKEN").unwrap_or_default()
        };

        let interval = if interval_seconds > 0 {
            interval_seconds
        } else {
            std::env::var("AURORA_HEARTBEAT_INTERVAL")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(10)
        };

        telemetry::start_telemetry(&url, &nid, &tok, interval, active_release_id);
    }));
    OK
}

/// Dừng Background Telemetry Thread khi NGINX Worker tắt.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_stop_telemetry() {
    let _ = catch_unwind(AssertUnwindSafe(telemetry::stop_telemetry));
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

