//! C-ABI Foreign Function Interface for Gateway Phase 5: HTTP Log Phase.
//!
//! # Architectural Model: Intrinsic Metrics Kernel <-> Pluggable Metrics Transport
//!
//! Aurora Gateway enforces a strict two-tier decoupled observability model:
//!
//! ```text
//!  Traffic Plane Hot-Path (NGINX C Worker)
//!         │
//!         ▼
//!  aurora_gateway_phase_log(&input)
//!         │
//!         ├───► [Subscriber Check: telemetry_subscribers() == 0]
//!         │            │
//!         │            ▼ (Yes: ZERO-COST STEALTH BYPASS)
//!         │      Exit in < 2ns (1 CPU test instruction)
//!         │      0 heap allocation, 0 lock, 0 histogram lookup, 0 formatting.
//!         │
//!         ▼ (No: Plugin has registered interest via bitmask)
//!  [Tier 1: Intrinsic Metrics Kernel (Lõi Metrics Nội Tại)]
//!         │  - Pure lock-free scalar atomic operations on L1 cacheline (< 3ns).
//!         │  - Agnostic to transport, protocol, scrapers, network sockets, or formats.
//!         │
//!         ▼ (Offloaded / Batched Snapshot)
//!  [Tier 2: Pluggable Metrics Transport (Plugin Vận Chuyển Metrics)]
//!            - Defined & owned entirely by extensions (`builtin/prometheus`, OTLP, StatsD).
//!            - Responsible for protocol encoding (OpenMetrics v0.0.4, OTLP Protobuf).
//!            - Responsible for wire transport (dedicated HTTP endpoint, push gateway, UNIX socket).
//!            - Registers interest via `aurora_gateway_telemetry_subscribe(TELEMETRY_SUB_METRICS)`.
//! ```
//!
//! ### Core Philosophy: "Minh bạch & Tàng hình" (Transparent & Stealth)
//! 1. **Tàng hình (Zero-Cost Stealth Inactivity)**:
//!    - If no metrics transport plugin is enabled in gateway configuration, transport is not started.
//!    - When transport does not start, the subscriber bitmask remains 0.
//!    - When subscriber bitmask is 0, the Intrinsic Metrics Kernel does NOT collect or process telemetry.
//!    - The hot path executes an immediate 1-instruction branch bypass (`subs == 0`) and returns in < 2ns.
//!    - Gateway performance, CPU utilization, and memory footprint are indistinguishable from raw NGINX.
//! 2. **Minh bạch (Strict Separation of Concerns - SRP)**:
//!    - The core engine NEVER knows how metrics are exported, serialized, or scraped.
//!    - The transport plugin NEVER blocks, locks, or pollutes the traffic worker's event loop.
//!
//! Handed off at `NGX_HTTP_LOG_PHASE` after the response has been sent to the client.
//! Dispatches typed asynchronous tasks (`StdLogTask`, `HttpMetricTask`) to the
//! companion Shadow Worker queue (< 20ns on the hot path, 0 blocking I/O).

use aurora_extensions::{
    AuroraLogInput, GatewayBackgroundTask, HttpMetricTask, StdLogTask, TELEMETRY_SUB_METRICS,
    TELEMETRY_SUB_STD_LOG, record_http_metrics, submit_task, telemetry_subscribers,
};

/// Returns current active telemetry subscribers bitmask.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_has_log_subscribers() -> u32 {
    telemetry_subscribers()
}

/// Registers one or more telemetry subscriber bits.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_telemetry_subscribe(mask: u32) {
    aurora_extensions::register_telemetry_subscriber(mask);
}

/// Unregisters one or more telemetry subscriber bits.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_telemetry_unsubscribe(mask: u32) {
    aurora_extensions::unregister_telemetry_subscriber(mask);
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

    // ZERO-COST STEALTH INACTIVITY BYPASS:
    // If no telemetry transport plugins (e.g. builtin/prometheus or access_log) are active,
    // the Intrinsic Metrics Kernel remains completely dormant.
    // This executes a single atomic load and test-branch, exiting in < 2ns.
    // No strings are extracted, no heap memory is touched, no histograms or counters are updated.
    let subs = telemetry_subscribers();
    if subs == 0 {
        return 0;
    }

    let raw = unsafe { &*input };

    if (subs & TELEMETRY_SUB_STD_LOG) != 0 {
        let log_task = StdLogTask::from_raw(raw);
        submit_task(GatewayBackgroundTask::StdLog(log_task));
    }

    if (subs & TELEMETRY_SUB_METRICS) != 0 {
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
        record_http_metrics(&metric_task);
    }

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
    use aurora_extensions::{
        GatewayBackgroundTask, TELEMETRY_SUB_METRICS, TELEMETRY_SUB_STD_LOG,
        get_worker_http_metrics, set_task_sender, set_telemetry_subscribers,
    };
    use tokio::sync::mpsc;

    #[test]
    fn test_phase_log_c_abi() {
        let (tx, mut rx) = mpsc::channel(16);
        set_task_sender(tx);
        set_telemetry_subscribers(TELEMETRY_SUB_STD_LOG | TELEMETRY_SUB_METRICS);

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
            timestamp_unix_nano: 1729000000000000000,
        };

        let rc = unsafe { aurora_gateway_phase_log(&input) };
        assert_eq!(rc, 0);

        let received1 = rx.try_recv().expect("must receive task 1");
        match received1 {
            GatewayBackgroundTask::StdLog(log) => {
                assert_eq!(log.client_ip(), "127.0.0.1");
                assert_eq!(log.method(), "GET");
                assert_eq!(log.uri(), "/test");
                assert_eq!(log.status, 200);
                assert_eq!(log.duration_ms, 15);
            }
            _ => panic!("expected std log task"),
        }

        let snap = get_worker_http_metrics().snapshot();
        assert!(snap.requests_2xx >= 1);
        assert!(snap.duration_sum_ms >= 15);
        assert!(snap.bytes_out >= 500);
        assert!(snap.bytes_in >= 100);

        // Test fast bypass when unobserved
        set_telemetry_subscribers(0);
        let rc2 = unsafe { aurora_gateway_phase_log(&input) };
        assert_eq!(rc2, 0);
        assert!(rx.try_recv().is_err(), "no tasks should be sent when bypassed");
    }
}
