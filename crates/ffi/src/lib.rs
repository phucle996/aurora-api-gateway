//! Aurora Gateway FFI - Lớp cầu nối giao tiếp C ABI (C Foreign Function Interface).
//!
//! Vai trò kiến trúc:
//! - Xuất các hàm Rust theo chuẩn C ABI (`extern "C"` với `#[no_mangle]`) để module NGINX viết bằng C
//!   có thể trực tiếp nhúng và gọi hàm của Engine mà không cần thông qua mạng hoặc socket.
//! - Thiết kế ABI v4: Sử dụng bộ đệm vay mượn (borrowed input buffers), dữ liệu trả về kiểu giá trị (value-only struct),
//!   và con trỏ đối tượng Engine bất biến (owned immutable engine handles).
//! - Substrate SHM phân chia rõ ràng: `shm::metrics` và `shm::logs`.
//! - Bọc toàn bộ các lời gọi bằng `catch_unwind` để đảm bảo nếu Rust xảy ra panic thì
//!   tuyệt đối không bị rò rỉ ra ngoài C làm sập tiến trình NGINX.

pub mod extensions;
pub mod shm;

pub use aurora_engine::Decision;
pub use extensions::ip_restriction;
#[deprecated(note = "Use ip_restriction instead")]
pub use extensions::ip_restriction as access;

/// Trả về số phiên bản ABI hiện tại của Aurora Gateway (hiện tại là 4).
/// Module NGINX sẽ gọi hàm này lúc khởi động để kiểm tra tính tương thích nhị phân.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_abi_version() -> u32 {
    4
}

#[deprecated(note = "Use aurora_gateway_abi_version instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_abi_version() -> u32 {
    aurora_gateway_abi_version()
}

pub(crate) const OK: u32 = 0;
pub(crate) const INVALID: u32 = 1;

/// Stop telemetry running state.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_stop_telemetry() {
    shm::stop_shm();
}

#[deprecated(note = "Use aurora_gateway_stop_telemetry instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_waf_stop_telemetry() {
    aurora_gateway_stop_telemetry();
}

/// Bind adapter-owned shared telemetry counters before starting worker threads.
/// # Safety
/// Both shared and active allocations must outlive the worker.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_bind_telemetry(
    shared: *mut std::ffi::c_void,
    len: usize,
    active: *mut std::ffi::c_void,
) -> u32 {
    if unsafe { shm::bind(shared.cast(), len, active.cast()) } {
        OK
    } else {
        INVALID
    }
}

#[deprecated(note = "Use aurora_gateway_bind_telemetry instead")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_waf_bind_telemetry(
    shared: *mut std::ffi::c_void,
    len: usize,
    active: *mut std::ffi::c_void,
) -> u32 {
    unsafe { aurora_gateway_bind_telemetry(shared, len, active) }
}

/// Initialize cross-process shared memory file for telemetry with Agent.
///
/// # Safety
/// If `path` is non-null, it must point to a valid null-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_telemetry_init_shm(path: *const std::ffi::c_char) -> u32 {
    if unsafe { shm::init_shm(path) } {
        OK
    } else {
        INVALID
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::ip_restriction::{
        IpRestrictionInput, aurora_ip_restriction_create, aurora_ip_restriction_destroy,
        aurora_ip_restriction_evaluate, aurora_ip_restriction_generation,
    };

    #[test]
    fn test_ip_restriction_ffi_lifecycle() {
        let snapshot_json = br#"{"schema_version":1,"generation":42,"rules":[{"id":101,"priority":1,"action":"block","networks":["192.168.1.0/24"],"host":"*","path_prefix":"/api","method":"*","schedule":"always","expires_at":0,"log":true,"reputation":false,"alert":false}]}"#;

        let mut engine = std::ptr::null_mut();
        let ret = unsafe {
            aurora_ip_restriction_create(snapshot_json.as_ptr(), snapshot_json.len(), &mut engine)
        };
        assert_eq!(ret, 0);
        assert!(!engine.is_null());

        let generation = unsafe { aurora_ip_restriction_generation(engine) };
        assert_eq!(generation, 42);

        let ip = b"192.168.1.50";
        let host = b"example.com";
        let path = b"/api/v1/resource";
        let method = b"GET";
        let input = IpRestrictionInput {
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
        let eval_status = unsafe { aurora_ip_restriction_evaluate(engine, &input, &mut decision) };
        assert_eq!(eval_status, 0);
        assert_eq!(decision.action, 1); // blocked
        assert_eq!(decision.rule_id, 101);
        assert_eq!(decision.generation, 42);

        unsafe { aurora_ip_restriction_destroy(engine) };
    }
}
