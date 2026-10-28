//! C-ABI Foreign Function Interface for Gateway Phase 5: HTTP Log Phase.
//!
//! Handed off at `NGX_HTTP_LOG_PHASE` after the response has been sent to the client.
//! Dispatches typed asynchronous tasks (`AccessLogTask`, `HttpMetricTask`) to the
//! companion Shadow Worker queue (< 20ns on the hot path, 0 blocking I/O).

use std::panic::catch_unwind;
use std::slice;

use aurora_engine::current_unix_nano;
use aurora_extensions::{
    AccessLogMetadata, AccessLogSlices, AccessLogTask, GatewayBackgroundTask, HttpMetricTask,
    submit_task,
};

/// Completed request snapshot passed from NGINX at `NGX_HTTP_LOG_PHASE`.
#[repr(C)]
pub struct AuroraLogInput {
    pub client_ip: *const u8,
    pub client_ip_len: usize,
    pub method: *const u8,
    pub method_len: usize,
    pub uri: *const u8,
    pub uri_len: usize,
    pub host: *const u8,
    pub host_len: usize,
    pub user_agent: *const u8,
    pub user_agent_len: usize,
    pub request_id: *const u8,
    pub request_id_len: usize,
    pub trace_id: *const u8,
    pub trace_id_len: usize,
    pub status: u32,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub upstream_status: u32,
    pub upstream_response_ms: u32,
    pub upstream_connect_ms: u32,
    pub is_ssl: u32,
    pub ssl_reused: u32,
    pub is_matched: u32,
    pub active_conns: u64,
    pub reading_conns: u64,
    pub writing_conns: u64,
    pub waiting_conns: u64,
}

#[inline(always)]
unsafe fn slice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(ptr, len) }
    }
}

/// Executes Gateway Phase 5: HTTP Log Phase.
///
/// Dispatches tasks to the Shadow Worker without contending with primary traffic serving.
///
/// # Safety
/// `input` must point to a valid, initialized `AuroraLogInput` struct.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_phase_log(input: *const AuroraLogInput) -> u32 {
    if input.is_null() {
        return 1;
    }

    let raw = unsafe { &*input };

    let _ = catch_unwind(move || {
        let slices = AccessLogSlices {
            client_ip: unsafe { slice_from_raw(raw.client_ip, raw.client_ip_len) },
            method: unsafe { slice_from_raw(raw.method, raw.method_len) },
            uri: unsafe { slice_from_raw(raw.uri, raw.uri_len) },
            host: unsafe { slice_from_raw(raw.host, raw.host_len) },
            user_agent: unsafe { slice_from_raw(raw.user_agent, raw.user_agent_len) },
            request_id: unsafe { slice_from_raw(raw.request_id, raw.request_id_len) },
            trace_id: unsafe { slice_from_raw(raw.trace_id, raw.trace_id_len) },
        };

        let meta = AccessLogMetadata {
            status: raw.status as u16,
            duration_ms: raw.duration_ms,
            bytes_sent: raw.bytes_sent,
            bytes_recv: raw.bytes_recv,
            upstream_status: raw.upstream_status as u16,
            upstream_response_ms: raw.upstream_response_ms,
            upstream_connect_ms: raw.upstream_connect_ms,
            is_ssl: raw.is_ssl != 0,
            ssl_reused: raw.ssl_reused != 0,
            is_matched: raw.is_matched != 0,
            timestamp_unix_nano: current_unix_nano(),
        };

        let log_task = AccessLogTask::from_slices(slices, meta);
        submit_task(GatewayBackgroundTask::AccessLog(Box::new(log_task)));

        let metric_task = HttpMetricTask {
            status: raw.status as u16,
            duration_ms: raw.duration_ms,
            bytes_sent: raw.bytes_sent,
            bytes_recv: raw.bytes_recv,
            active_conns: raw.active_conns,
            reading_conns: raw.reading_conns,
            writing_conns: raw.writing_conns,
            waiting_conns: raw.waiting_conns,
        };
        submit_task(GatewayBackgroundTask::HttpMetric(metric_task));
    });

    0
}

/// Increments the live in-flight request gauge at Access Phase Ingress (< 1ns).
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_in_flight_enter() {
    aurora_engine::metrics::in_flight_enter();
}

/// Decrements the live in-flight request gauge at Log Phase Egress (< 1ns).
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_in_flight_leave() {
    aurora_engine::metrics::in_flight_leave();
}

/// Returns the current live in-flight request count.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_in_flight_count() -> u64 {
    aurora_engine::metrics::get_in_flight()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aurora_extensions::{GatewayBackgroundTask, logged_tasks_count, set_task_sender};
    use tokio::sync::mpsc;

    #[test]
    fn test_phase_log_c_abi() {
        let (tx, mut rx) = mpsc::channel(16);
        set_task_sender(tx);

        let ip = b"127.0.0.1";
        let method = b"GET";
        let uri = b"/test";

        let input = AuroraLogInput {
            client_ip: ip.as_ptr(),
            client_ip_len: ip.len(),
            method: method.as_ptr(),
            method_len: method.len(),
            uri: uri.as_ptr(),
            uri_len: uri.len(),
            host: std::ptr::null(),
            host_len: 0,
            user_agent: std::ptr::null(),
            user_agent_len: 0,
            request_id: std::ptr::null(),
            request_id_len: 0,
            trace_id: std::ptr::null(),
            trace_id_len: 0,
            status: 200,
            duration_ms: 15,
            bytes_sent: 500,
            bytes_recv: 100,
            upstream_status: 0,
            upstream_response_ms: 0,
            upstream_connect_ms: 0,
            is_ssl: 0,
            ssl_reused: 0,
            is_matched: 1,
            active_conns: 10,
            reading_conns: 2,
            writing_conns: 3,
            waiting_conns: 5,
        };

        let rc = unsafe { aurora_gateway_phase_log(&input) };
        assert_eq!(rc, 0);

        let received1 = rx.try_recv().expect("must receive task 1");
        match received1 {
            GatewayBackgroundTask::AccessLog(log) => {
                assert_eq!(log.client_ip(), "127.0.0.1");
                assert_eq!(log.method(), "GET");
                assert_eq!(log.uri(), "/test");
                assert_eq!(log.status, 200);
                assert_eq!(log.duration_ms, 15);
            }
            _ => panic!("expected access log task"),
        }

        let received2 = rx.try_recv().expect("must receive task 2");
        match received2 {
            GatewayBackgroundTask::HttpMetric(metric) => {
                assert_eq!(metric.status, 200);
                assert_eq!(metric.duration_ms, 15);
                assert_eq!(metric.bytes_sent, 500);
                assert_eq!(metric.bytes_recv, 100);
            }
            _ => panic!("expected metric task"),
        }

        assert!(logged_tasks_count() >= 2);
    }
}
