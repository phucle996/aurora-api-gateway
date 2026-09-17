//! Shared Memory Core Metrics Recording (C ABI Layer)
//!
//! Sub-nanosecond lockless recording for HTTP status, request latencies, and extension metrics.

use super::gateway_metrics;

// ----------------------------------------------------------------------------
// HTTP & Connection Metrics
// ----------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_request(status: u32, duration_ms: u64) {
    if let Some(m) = gateway_metrics() {
        m.record_http_request(status, duration_ms);
    }
}

#[deprecated(note = "Use aurora_gateway_record_request instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_request(status: u32, duration_ms: u64) {
    aurora_gateway_record_request(status, duration_ms);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_connections(
    active: u64,
    reading: u64,
    writing: u64,
    waiting: u64,
) {
    if let Some(m) = gateway_metrics() {
        m.record_connections(active, reading, writing, waiting);
    }
}

#[deprecated(note = "Use aurora_gateway_record_connections instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_connections(
    active: u64,
    reading: u64,
    writing: u64,
    waiting: u64,
) {
    aurora_gateway_record_connections(active, reading, writing, waiting);
}

// ----------------------------------------------------------------------------
// Extension Metrics
// ----------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_pipeline(action: u32) {
    if let Some(total) = super::shared_slot(0) {
        total.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if let Some(counter) = super::shared_slot(if action == 1 { 2 } else { 1 }) {
            counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
    if let Some(m) = gateway_metrics() {
        m.record_waf(action);
    }
}

#[deprecated(note = "Use aurora_gateway_record_pipeline instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_waf(action: u32) {
    aurora_gateway_record_pipeline(action);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_ip_restriction(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ip_restriction(action);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_ip_restriction(action: u32) {
    aurora_gateway_record_ip_restriction(action);
}

#[deprecated(note = "Use aurora_gateway_record_ip_restriction instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_access(action: u32) {
    aurora_gateway_record_ip_restriction(action);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_ratelimit(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ratelimit(action);
    }
}

#[deprecated(note = "Use aurora_gateway_record_ratelimit instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_ratelimit(action: u32) {
    aurora_gateway_record_ratelimit(action);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_jwt(status: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_jwt(status);
    }
}

#[deprecated(note = "Use aurora_gateway_record_jwt instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_jwt(status: u32) {
    aurora_gateway_record_jwt(status);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_conn_limit(blocked: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_conn_limit(blocked != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_conn_limit instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_conn_limit(blocked: u32) {
    aurora_gateway_record_conn_limit(blocked);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_traffic_shaper(delayed: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_shaper(delayed != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_traffic_shaper instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_traffic_shaper(delayed: u32) {
    aurora_gateway_record_traffic_shaper(delayed);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_request_size(rejected: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_request_size(rejected != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_request_size instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_request_size(rejected: u32) {
    aurora_gateway_record_request_size(rejected);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_termination() {
    if let Some(m) = gateway_metrics() {
        m.record_termination();
    }
}

#[deprecated(note = "Use aurora_gateway_record_termination instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_termination() {
    aurora_gateway_record_termination();
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_traffic_split(secondary: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_split(secondary != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_traffic_split instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_traffic_split(secondary: u32) {
    aurora_gateway_record_traffic_split(secondary);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_canary(is_canary: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_canary(is_canary != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_canary instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_canary(is_canary: u32) {
    aurora_gateway_record_canary(is_canary);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_blue_green(is_green: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_blue_green(is_green != 0);
    }
}

#[deprecated(note = "Use aurora_gateway_record_blue_green instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_blue_green(is_green: u32) {
    aurora_gateway_record_blue_green(is_green);
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_mirror() {
    if let Some(m) = gateway_metrics() {
        m.record_mirror();
    }
}

#[deprecated(note = "Use aurora_gateway_record_mirror instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_record_mirror() {
    aurora_gateway_record_mirror();
}
