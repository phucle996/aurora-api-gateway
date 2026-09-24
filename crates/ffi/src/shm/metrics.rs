//! Shared Memory Core Metrics Recording (C ABI Layer)
//!
//! Sub-nanosecond lockless recording for HTTP, L7 traffic, L4/SSL, upstream, and extension metrics.

use super::gateway_metrics;

// ----------------------------------------------------------------------------
// L7 Metrics: HTTP & Traffic Volume
// ----------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_request(status: u32, duration_ms: u64) {
    if let Some(m) = gateway_metrics() {
        m.record_http_request(status, duration_ms);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_traffic(
    bytes_in: u64,
    bytes_out: u64,
    is_ssl: u32,
    is_matched: u32,
) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic(bytes_in, bytes_out, is_ssl != 0, is_matched != 0);
    }
}

// ----------------------------------------------------------------------------
// L4 Metrics: Connections & SSL/TLS
// ----------------------------------------------------------------------------

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

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_ssl(handshake_ok: u32, reused: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ssl(handshake_ok != 0, reused != 0);
    }
}

// ----------------------------------------------------------------------------
// Upstream Metrics
// ----------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_record_upstream(
    status: u32,
    response_ms: u64,
    connect_ms: u64,
    failed: u32,
) {
    if let Some(m) = gateway_metrics() {
        m.record_upstream(status, response_ms, connect_ms, failed != 0);
    }
}

// ----------------------------------------------------------------------------
// Extension Metrics
// ----------------------------------------------------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn extension_ip_restriction_record_metrics(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ip_restriction(action);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_rate_limit_record_metrics(action: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_ratelimit(action);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_jwt_record_metrics(status: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_jwt(status);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_conn_limit_record_metrics(blocked: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_conn_limit(blocked != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_traffic_shaper_record_metrics(delayed: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_shaper(delayed != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_request_size_record_metrics(rejected: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_request_size(rejected != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_termination_record_metrics() {
    if let Some(m) = gateway_metrics() {
        m.record_termination();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_traffic_split_record_metrics(secondary: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_traffic_split(secondary != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_canary_record_metrics(is_canary: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_canary(is_canary != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_blue_green_record_metrics(is_green: u32) {
    if let Some(m) = gateway_metrics() {
        m.record_blue_green(is_green != 0);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn extension_mirror_record_metrics() {
    if let Some(m) = gateway_metrics() {
        m.record_mirror();
    }
}
