//! Aurora WAF FFI - Lớp cầu nối giao tiếp C ABI (C Foreign Function Interface).
//!
//! Vai trò kiến trúc:
//! - Xuất các hàm Rust theo chuẩn C ABI (`extern "C"` với `#[no_mangle]`) để module NGINX viết bằng C
//!   có thể trực tiếp nhúng và gọi hàm của Engine mà không cần thông qua mạng hoặc socket.
//! - Thiết kế ABI v3: Sử dụng bộ đệm vay mượn (borrowed input buffers), dữ liệu trả về kiểu giá trị (value-only struct),
//!   và con trỏ đối tượng Engine bất biến (owned immutable engine handles).
//! - Bọc toàn bộ các lời gọi bằng `catch_unwind` để đảm bảo nếu Rust xảy ra panic thì
//!   tuyệt đối không bị rò rỉ ra ngoài C làm sập tiến trình NGINX.

pub mod extensions;
pub mod telemetry;
pub mod upstream;

pub use aurora_engine::Decision;
pub use extensions::access;
pub use extensions::connection_limit;
pub use extensions::jwt;
pub use extensions::rate_limit;
pub use extensions::request_size_limit;
pub use extensions::traffic_shaper;
pub use extensions::traffic_split;
pub use extensions::traffic_split::*;
pub use extensions::canary_release;
pub use extensions::canary_release::*;
pub use extensions::waf;
pub use extensions::waf::*;

use std::panic::{AssertUnwindSafe, catch_unwind};

/// Mã trạng thái trả về cho caller C:
pub(crate) const OK: u32 = 0;
pub(crate) const INVALID: u32 = 1;
#[allow(dead_code)]
pub(crate) const PANIC: u32 = 2;

/// Deprecated no-op: Runtime and control-plane synchronization is now handled out-of-process
/// by aurora-agent. Retained for C ABI symbol backward-compatibility.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_start_runtime(
    _controller_url: *const std::ffi::c_char,
    _node_id: *const std::ffi::c_char,
    _token: *const std::ffi::c_char,
    _interval_seconds: u32,
    _active_release_id: i64,
    _policy_path: *const std::ffi::c_char,
    _access_path: *const std::ffi::c_char,
    _is_leader: u32,
) -> u32 {
    OK
}

/// Deprecated no-op: Retained for C ABI symbol backward-compatibility.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_start_telemetry(
    _controller_url: *const std::ffi::c_char,
    _node_id: *const std::ffi::c_char,
    _token: *const std::ffi::c_char,
    _interval_seconds: u32,
    _active_release_id: i64,
) -> u32 {
    OK
}

/// Deprecated no-op: Retained for C ABI symbol backward-compatibility.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_stop_telemetry() {
    telemetry::stop_telemetry();
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
        let eval_status =
            unsafe { aurora_access_evaluate(std::ptr::null(), &input, &mut decision) };
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
        let rec_status =
            unsafe { aurora_access_record_match(42, 999, explicit_ip.as_ptr(), explicit_ip.len()) };
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
