//! Shared Memory Metrics Objects & Layout
//!
//! Lockless, zero-allocation data plane metrics recording across L7, L4, upstream, and all extensions.
//! Composed of independent C-compatible metric objects inside a 4096-byte page.

use std::sync::atomic::{AtomicU64, Ordering};

use super::logs::{LogBusMetrics, LogBusMetricsSnapshot};
use super::{TELEMETRY_MAGIC, TELEMETRY_VERSION};

// ============================================================================
// L7 Metric Objects (HTTP Layer)
// ============================================================================

/// Core HTTP Metrics Object (Requests, Status classes, Duration buckets)
#[repr(C)]
#[derive(Debug, Default)]
pub struct HttpMetrics {
    pub requests_total: AtomicU64,
    pub status_2xx: AtomicU64,
    pub status_3xx: AtomicU64,
    pub status_4xx: AtomicU64,
    pub status_5xx: AtomicU64,
    pub status_other: AtomicU64,

    pub duration_bucket_1ms: AtomicU64,
    pub duration_bucket_5ms: AtomicU64,
    pub duration_bucket_10ms: AtomicU64,
    pub duration_bucket_50ms: AtomicU64,
    pub duration_bucket_100ms: AtomicU64,
    pub duration_bucket_500ms: AtomicU64,
    pub duration_bucket_1000ms: AtomicU64,
    pub duration_bucket_inf: AtomicU64,
    pub duration_sum_ms: AtomicU64,
}

impl HttpMetrics {
    pub const fn new() -> Self {
        Self {
            requests_total: AtomicU64::new(0),
            status_2xx: AtomicU64::new(0),
            status_3xx: AtomicU64::new(0),
            status_4xx: AtomicU64::new(0),
            status_5xx: AtomicU64::new(0),
            status_other: AtomicU64::new(0),
            duration_bucket_1ms: AtomicU64::new(0),
            duration_bucket_5ms: AtomicU64::new(0),
            duration_bucket_10ms: AtomicU64::new(0),
            duration_bucket_50ms: AtomicU64::new(0),
            duration_bucket_100ms: AtomicU64::new(0),
            duration_bucket_500ms: AtomicU64::new(0),
            duration_bucket_1000ms: AtomicU64::new(0),
            duration_bucket_inf: AtomicU64::new(0),
            duration_sum_ms: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, status: u32, duration_ms: u64) {
        self.requests_total.fetch_add(1, Ordering::Relaxed);
        match status {
            200..=299 => self.status_2xx.fetch_add(1, Ordering::Relaxed),
            300..=399 => self.status_3xx.fetch_add(1, Ordering::Relaxed),
            400..=499 => self.status_4xx.fetch_add(1, Ordering::Relaxed),
            500..=599 => self.status_5xx.fetch_add(1, Ordering::Relaxed),
            _ => self.status_other.fetch_add(1, Ordering::Relaxed),
        };

        if duration_ms <= 1 {
            self.duration_bucket_1ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 5 {
            self.duration_bucket_5ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 10 {
            self.duration_bucket_10ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 50 {
            self.duration_bucket_50ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 100 {
            self.duration_bucket_100ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 500 {
            self.duration_bucket_500ms.fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 1000 {
            self.duration_bucket_1000ms.fetch_add(1, Ordering::Relaxed);
        }
        self.duration_bucket_inf.fetch_add(1, Ordering::Relaxed);
        self.duration_sum_ms
            .fetch_add(duration_ms, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> HttpMetricsSnapshot {
        HttpMetricsSnapshot {
            requests_total: self.requests_total.load(Ordering::Relaxed),
            status_2xx: self.status_2xx.load(Ordering::Relaxed),
            status_3xx: self.status_3xx.load(Ordering::Relaxed),
            status_4xx: self.status_4xx.load(Ordering::Relaxed),
            status_5xx: self.status_5xx.load(Ordering::Relaxed),
            status_other: self.status_other.load(Ordering::Relaxed),
            duration_bucket_1ms: self.duration_bucket_1ms.load(Ordering::Relaxed),
            duration_bucket_5ms: self.duration_bucket_5ms.load(Ordering::Relaxed),
            duration_bucket_10ms: self.duration_bucket_10ms.load(Ordering::Relaxed),
            duration_bucket_50ms: self.duration_bucket_50ms.load(Ordering::Relaxed),
            duration_bucket_100ms: self.duration_bucket_100ms.load(Ordering::Relaxed),
            duration_bucket_500ms: self.duration_bucket_500ms.load(Ordering::Relaxed),
            duration_bucket_1000ms: self.duration_bucket_1000ms.load(Ordering::Relaxed),
            duration_bucket_inf: self.duration_bucket_inf.load(Ordering::Relaxed),
            duration_sum_ms: self.duration_sum_ms.load(Ordering::Relaxed),
        }
    }
}

/// L7 Traffic Volume Metrics (bytes in/out, SSL request count, matched request count)
#[repr(C)]
#[derive(Debug, Default)]
pub struct L7TrafficMetrics {
    pub request_bytes_in: AtomicU64,
    pub response_bytes_out: AtomicU64,
    pub requests_ssl: AtomicU64,
    pub requests_matched: AtomicU64,
}

impl L7TrafficMetrics {
    pub const fn new() -> Self {
        Self {
            request_bytes_in: AtomicU64::new(0),
            response_bytes_out: AtomicU64::new(0),
            requests_ssl: AtomicU64::new(0),
            requests_matched: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, bytes_in: u64, bytes_out: u64, is_ssl: bool, is_matched: bool) {
        self.request_bytes_in.fetch_add(bytes_in, Ordering::Relaxed);
        self.response_bytes_out
            .fetch_add(bytes_out, Ordering::Relaxed);
        if is_ssl {
            self.requests_ssl.fetch_add(1, Ordering::Relaxed);
        }
        if is_matched {
            self.requests_matched.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> L7TrafficMetricsSnapshot {
        L7TrafficMetricsSnapshot {
            request_bytes_in: self.request_bytes_in.load(Ordering::Relaxed),
            response_bytes_out: self.response_bytes_out.load(Ordering::Relaxed),
            requests_ssl: self.requests_ssl.load(Ordering::Relaxed),
            requests_matched: self.requests_matched.load(Ordering::Relaxed),
        }
    }
}

// ============================================================================
// L4 Metric Objects (Connection / TLS Layer)
// ============================================================================

/// NGINX Worker Connection Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct ConnectionMetrics {
    pub active: AtomicU64,
    pub reading: AtomicU64,
    pub writing: AtomicU64,
    pub waiting: AtomicU64,
}

impl ConnectionMetrics {
    pub const fn new() -> Self {
        Self {
            active: AtomicU64::new(0),
            reading: AtomicU64::new(0),
            writing: AtomicU64::new(0),
            waiting: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, active: u64, reading: u64, writing: u64, waiting: u64) {
        self.active.store(active, Ordering::Relaxed);
        self.reading.store(reading, Ordering::Relaxed);
        self.writing.store(writing, Ordering::Relaxed);
        self.waiting.store(waiting, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> ConnectionMetricsSnapshot {
        ConnectionMetricsSnapshot {
            active: self.active.load(Ordering::Relaxed),
            reading: self.reading.load(Ordering::Relaxed),
            writing: self.writing.load(Ordering::Relaxed),
            waiting: self.waiting.load(Ordering::Relaxed),
        }
    }
}

/// SSL/TLS Connection Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct SslMetrics {
    pub handshakes_total: AtomicU64,
    pub handshakes_failed: AtomicU64,
    pub sessions_reused: AtomicU64,
}

impl SslMetrics {
    pub const fn new() -> Self {
        Self {
            handshakes_total: AtomicU64::new(0),
            handshakes_failed: AtomicU64::new(0),
            sessions_reused: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, handshake_ok: bool, reused: bool) {
        self.handshakes_total.fetch_add(1, Ordering::Relaxed);
        if !handshake_ok {
            self.handshakes_failed.fetch_add(1, Ordering::Relaxed);
        }
        if reused {
            self.sessions_reused.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> SslMetricsSnapshot {
        SslMetricsSnapshot {
            handshakes_total: self.handshakes_total.load(Ordering::Relaxed),
            handshakes_failed: self.handshakes_failed.load(Ordering::Relaxed),
            sessions_reused: self.sessions_reused.load(Ordering::Relaxed),
        }
    }
}

// ============================================================================
// Upstream Metric Objects
// ============================================================================

/// Upstream backend response metrics
#[repr(C)]
#[derive(Debug, Default)]
pub struct UpstreamMetrics {
    pub requests_total: AtomicU64,
    pub responses_2xx: AtomicU64,
    pub responses_5xx: AtomicU64,
    pub response_time_sum_ms: AtomicU64,
    pub connect_time_sum_ms: AtomicU64,
    pub failures: AtomicU64,
}

impl UpstreamMetrics {
    pub const fn new() -> Self {
        Self {
            requests_total: AtomicU64::new(0),
            responses_2xx: AtomicU64::new(0),
            responses_5xx: AtomicU64::new(0),
            response_time_sum_ms: AtomicU64::new(0),
            connect_time_sum_ms: AtomicU64::new(0),
            failures: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, status: u32, response_ms: u64, connect_ms: u64, failed: bool) {
        self.requests_total.fetch_add(1, Ordering::Relaxed);
        match status {
            200..=299 => {
                self.responses_2xx.fetch_add(1, Ordering::Relaxed);
            }
            500..=599 => {
                self.responses_5xx.fetch_add(1, Ordering::Relaxed);
            }
            _ => {}
        }
        self.response_time_sum_ms
            .fetch_add(response_ms, Ordering::Relaxed);
        self.connect_time_sum_ms
            .fetch_add(connect_ms, Ordering::Relaxed);
        if failed {
            self.failures.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> UpstreamMetricsSnapshot {
        UpstreamMetricsSnapshot {
            requests_total: self.requests_total.load(Ordering::Relaxed),
            responses_2xx: self.responses_2xx.load(Ordering::Relaxed),
            responses_5xx: self.responses_5xx.load(Ordering::Relaxed),
            response_time_sum_ms: self.response_time_sum_ms.load(Ordering::Relaxed),
            connect_time_sum_ms: self.connect_time_sum_ms.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
        }
    }
}

// ============================================================================
// Extension Metric Objects (C-compatible #[repr(C)], lockless atomic counters)
// ============================================================================

/// IP Restriction Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct IpRestrictionMetrics {
    pub allow: AtomicU64,
    pub block: AtomicU64,
}

pub type AccessMetrics = IpRestrictionMetrics;

impl IpRestrictionMetrics {
    pub const fn new() -> Self {
        Self {
            allow: AtomicU64::new(0),
            block: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, action: u32) {
        if action == 1 {
            self.block.fetch_add(1, Ordering::Relaxed);
        } else {
            self.allow.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> IpRestrictionMetricsSnapshot {
        IpRestrictionMetricsSnapshot {
            allow: self.allow.load(Ordering::Relaxed),
            block: self.block.load(Ordering::Relaxed),
        }
    }
}

/// Rate Limiting Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct RateLimitMetrics {
    pub allowed: AtomicU64,
    pub throttled: AtomicU64,
    pub rejected: AtomicU64,
}

impl RateLimitMetrics {
    pub const fn new() -> Self {
        Self {
            allowed: AtomicU64::new(0),
            throttled: AtomicU64::new(0),
            rejected: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, action: u32) {
        match action {
            0 => self.allowed.fetch_add(1, Ordering::Relaxed),
            1 => self.throttled.fetch_add(1, Ordering::Relaxed),
            _ => self.rejected.fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn snapshot(&self) -> RateLimitMetricsSnapshot {
        RateLimitMetricsSnapshot {
            allowed: self.allowed.load(Ordering::Relaxed),
            throttled: self.throttled.load(Ordering::Relaxed),
            rejected: self.rejected.load(Ordering::Relaxed),
        }
    }
}

/// JWT Authentication Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct JwtMetrics {
    pub valid: AtomicU64,
    pub invalid: AtomicU64,
    pub expired: AtomicU64,
    pub missing: AtomicU64,
}

impl JwtMetrics {
    pub const fn new() -> Self {
        Self {
            valid: AtomicU64::new(0),
            invalid: AtomicU64::new(0),
            expired: AtomicU64::new(0),
            missing: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, status: u32) {
        match status {
            0 => self.valid.fetch_add(1, Ordering::Relaxed),
            1 => self.invalid.fetch_add(1, Ordering::Relaxed),
            2 => self.expired.fetch_add(1, Ordering::Relaxed),
            _ => self.missing.fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn snapshot(&self) -> JwtMetricsSnapshot {
        JwtMetricsSnapshot {
            valid: self.valid.load(Ordering::Relaxed),
            invalid: self.invalid.load(Ordering::Relaxed),
            expired: self.expired.load(Ordering::Relaxed),
            missing: self.missing.load(Ordering::Relaxed),
        }
    }
}

/// Connection Limit Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct ConnLimitMetrics {
    pub rejected: AtomicU64,
}

impl ConnLimitMetrics {
    pub const fn new() -> Self {
        Self {
            rejected: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, blocked: bool) {
        if blocked {
            self.rejected.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> ConnLimitMetricsSnapshot {
        ConnLimitMetricsSnapshot {
            rejected: self.rejected.load(Ordering::Relaxed),
        }
    }
}

/// Traffic Shaper Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct TrafficShaperMetrics {
    pub delayed: AtomicU64,
}

impl TrafficShaperMetrics {
    pub const fn new() -> Self {
        Self {
            delayed: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, delayed: bool) {
        if delayed {
            self.delayed.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> TrafficShaperMetricsSnapshot {
        TrafficShaperMetricsSnapshot {
            delayed: self.delayed.load(Ordering::Relaxed),
        }
    }
}

/// Request Size Limit Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct RequestSizeMetrics {
    pub rejected: AtomicU64,
}

impl RequestSizeMetrics {
    pub const fn new() -> Self {
        Self {
            rejected: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, rejected: bool) {
        if rejected {
            self.rejected.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> RequestSizeMetricsSnapshot {
        RequestSizeMetricsSnapshot {
            rejected: self.rejected.load(Ordering::Relaxed),
        }
    }
}

/// Request Termination Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct TerminationMetrics {
    pub triggered: AtomicU64,
}

impl TerminationMetrics {
    pub const fn new() -> Self {
        Self {
            triggered: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self) {
        self.triggered.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> TerminationMetricsSnapshot {
        TerminationMetricsSnapshot {
            triggered: self.triggered.load(Ordering::Relaxed),
        }
    }
}

/// Traffic Split Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct TrafficSplitMetrics {
    pub primary: AtomicU64,
    pub secondary: AtomicU64,
}

impl TrafficSplitMetrics {
    pub const fn new() -> Self {
        Self {
            primary: AtomicU64::new(0),
            secondary: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, secondary: bool) {
        if secondary {
            self.secondary.fetch_add(1, Ordering::Relaxed);
        } else {
            self.primary.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> TrafficSplitMetricsSnapshot {
        TrafficSplitMetricsSnapshot {
            primary: self.primary.load(Ordering::Relaxed),
            secondary: self.secondary.load(Ordering::Relaxed),
        }
    }
}

/// Canary Release Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct CanaryMetrics {
    pub baseline: AtomicU64,
    pub canary: AtomicU64,
}

impl CanaryMetrics {
    pub const fn new() -> Self {
        Self {
            baseline: AtomicU64::new(0),
            canary: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, is_canary: bool) {
        if is_canary {
            self.canary.fetch_add(1, Ordering::Relaxed);
        } else {
            self.baseline.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> CanaryMetricsSnapshot {
        CanaryMetricsSnapshot {
            baseline: self.baseline.load(Ordering::Relaxed),
            canary: self.canary.load(Ordering::Relaxed),
        }
    }
}

/// Blue-Green Routing Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct BlueGreenMetrics {
    pub blue: AtomicU64,
    pub green: AtomicU64,
}

impl BlueGreenMetrics {
    pub const fn new() -> Self {
        Self {
            blue: AtomicU64::new(0),
            green: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, is_green: bool) {
        if is_green {
            self.green.fetch_add(1, Ordering::Relaxed);
        } else {
            self.blue.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> BlueGreenMetricsSnapshot {
        BlueGreenMetricsSnapshot {
            blue: self.blue.load(Ordering::Relaxed),
            green: self.green.load(Ordering::Relaxed),
        }
    }
}

/// Request Mirror Extension Metrics Object
#[repr(C)]
#[derive(Debug, Default)]
pub struct MirrorMetrics {
    pub sampled: AtomicU64,
}

impl MirrorMetrics {
    pub const fn new() -> Self {
        Self {
            sampled: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self) {
        self.sampled.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> MirrorMetricsSnapshot {
        MirrorMetricsSnapshot {
            sampled: self.sampled.load(Ordering::Relaxed),
        }
    }
}

// ============================================================================
// Master Shared Memory Struct (4096 bytes page-aligned)
// ============================================================================

/// Padded lockless shared memory struct shared between NGINX workers and Aurora Agent.
///
/// Layout is organized by network layer:
/// - L7 (HTTP): Request status, latency histogram, traffic volume
/// - L4 (Connection/TLS): Connection gauges, SSL handshake counters
/// - Upstream: Backend response status, latency sums, failures
/// - Extensions: Per-extension evaluation counters
/// - Infra: Log bus gating
///
/// Size is strictly aligned and padded to 4096 bytes (1 memory page).
#[repr(C)]
pub struct GatewaySharedMetrics {
    pub magic: u32,
    pub version: u32,
    pub generation: AtomicU64,

    // L7 Metrics (152 bytes)
    pub http: HttpMetrics,            // 120 bytes
    pub l7_traffic: L7TrafficMetrics, // 32 bytes

    // L4 Metrics (56 bytes)
    pub connections: ConnectionMetrics, // 32 bytes
    pub ssl: SslMetrics,                // 24 bytes

    // Upstream Metrics (48 bytes)
    pub upstream: UpstreamMetrics, // 48 bytes

    // Extension Metric Objects (144 bytes)
    pub ip_restriction: IpRestrictionMetrics, // 16 bytes
    pub ratelimit: RateLimitMetrics,          // 24 bytes
    pub jwt: JwtMetrics,                      // 32 bytes
    pub conn_limit: ConnLimitMetrics,         // 8 bytes
    pub traffic_shaper: TrafficShaperMetrics, // 8 bytes
    pub request_size: RequestSizeMetrics,     // 8 bytes
    pub termination: TerminationMetrics,      // 8 bytes
    pub traffic_split: TrafficSplitMetrics,   // 16 bytes
    pub canary: CanaryMetrics,                // 16 bytes
    pub blue_green: BlueGreenMetrics,         // 16 bytes
    pub mirror: MirrorMetrics,                // 8 bytes

    // Infra (8 bytes)
    pub log_bus: LogBusMetrics, // 8 bytes

    // Padding: 16 + 152 + 56 + 48 + 144 + 8 + 16 = 440 data bytes; 3656 padding
    _reserved: [u8; 4096 - 440],
}

impl Default for GatewaySharedMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl GatewaySharedMetrics {
    pub const fn new() -> Self {
        Self {
            magic: TELEMETRY_MAGIC,
            version: TELEMETRY_VERSION,
            generation: AtomicU64::new(0),
            http: HttpMetrics::new(),
            l7_traffic: L7TrafficMetrics::new(),
            connections: ConnectionMetrics::new(),
            ssl: SslMetrics::new(),
            upstream: UpstreamMetrics::new(),
            ip_restriction: IpRestrictionMetrics::new(),
            ratelimit: RateLimitMetrics::new(),
            jwt: JwtMetrics::new(),
            conn_limit: ConnLimitMetrics::new(),
            traffic_shaper: TrafficShaperMetrics::new(),
            request_size: RequestSizeMetrics::new(),
            termination: TerminationMetrics::new(),
            traffic_split: TrafficSplitMetrics::new(),
            canary: CanaryMetrics::new(),
            blue_green: BlueGreenMetrics::new(),
            mirror: MirrorMetrics::new(),
            log_bus: LogBusMetrics::new(),
            _reserved: [0u8; 4096 - 440],
        }
    }

    /// Initializes header fields if uninitialized.
    pub fn ensure_header(&mut self) {
        if self.magic != TELEMETRY_MAGIC {
            self.magic = TELEMETRY_MAGIC;
            self.version = TELEMETRY_VERSION;
        }
    }

    // L7 Recording

    /// Record completed HTTP request status code and duration in milliseconds.
    #[inline(always)]
    pub fn record_http_request(&self, status: u32, duration_ms: u64) {
        self.http.record(status, duration_ms);
    }

    #[inline(always)]
    pub fn record_traffic(&self, bytes_in: u64, bytes_out: u64, is_ssl: bool, is_matched: bool) {
        self.l7_traffic
            .record(bytes_in, bytes_out, is_ssl, is_matched);
    }

    // L4 Recording

    #[inline(always)]
    pub fn record_connections(&self, active: u64, reading: u64, writing: u64, waiting: u64) {
        self.connections.record(active, reading, writing, waiting);
    }

    #[inline(always)]
    pub fn record_ssl(&self, handshake_ok: bool, reused: bool) {
        self.ssl.record(handshake_ok, reused);
    }

    // Upstream Recording

    #[inline(always)]
    pub fn record_upstream(&self, status: u32, response_ms: u64, connect_ms: u64, failed: bool) {
        self.upstream
            .record(status, response_ms, connect_ms, failed);
    }

    // Extension Recording

    #[inline(always)]
    pub fn record_ip_restriction(&self, action: u32) {
        self.ip_restriction.record(action);
    }

    #[inline(always)]
    pub fn record_ratelimit(&self, action: u32) {
        self.ratelimit.record(action);
    }

    #[inline(always)]
    pub fn record_jwt(&self, status: u32) {
        self.jwt.record(status);
    }

    #[inline(always)]
    pub fn record_conn_limit(&self, blocked: bool) {
        self.conn_limit.record(blocked);
    }

    #[inline(always)]
    pub fn record_traffic_shaper(&self, delayed: bool) {
        self.traffic_shaper.record(delayed);
    }

    #[inline(always)]
    pub fn record_request_size(&self, rejected: bool) {
        self.request_size.record(rejected);
    }

    #[inline(always)]
    pub fn record_termination(&self) {
        self.termination.record();
    }

    #[inline(always)]
    pub fn record_traffic_split(&self, secondary: bool) {
        self.traffic_split.record(secondary);
    }

    #[inline(always)]
    pub fn record_canary(&self, is_canary: bool) {
        self.canary.record(is_canary);
    }

    #[inline(always)]
    pub fn record_blue_green(&self, is_green: bool) {
        self.blue_green.record(is_green);
    }

    #[inline(always)]
    pub fn record_mirror(&self) {
        self.mirror.record();
    }

    // Infra

    #[inline(always)]
    pub fn register_log_consumer(&self) -> u64 {
        self.log_bus.register()
    }

    #[inline(always)]
    pub fn unregister_log_consumer(&self) -> u64 {
        self.log_bus.unregister()
    }

    #[inline(always)]
    pub fn is_log_active(&self) -> bool {
        self.log_bus.is_active()
    }

    #[inline(always)]
    pub fn active_log_consumers_count(&self) -> u64 {
        self.log_bus.count()
    }

    #[inline(always)]
    pub fn reset_log_consumers(&self) {
        self.log_bus.reset();
    }

    /// Read non-blocking snapshot of all metrics for Prometheus formatting.
    pub fn snapshot(&self) -> GatewayMetricsSnapshot {
        GatewayMetricsSnapshot {
            http: self.http.snapshot(),
            l7_traffic: self.l7_traffic.snapshot(),
            connections: self.connections.snapshot(),
            ssl: self.ssl.snapshot(),
            upstream: self.upstream.snapshot(),
            ip_restriction: self.ip_restriction.snapshot(),
            ratelimit: self.ratelimit.snapshot(),
            jwt: self.jwt.snapshot(),
            conn_limit: self.conn_limit.snapshot(),
            traffic_shaper: self.traffic_shaper.snapshot(),
            request_size: self.request_size.snapshot(),
            termination: self.termination.snapshot(),
            traffic_split: self.traffic_split.snapshot(),
            canary: self.canary.snapshot(),
            blue_green: self.blue_green.snapshot(),
            mirror: self.mirror.snapshot(),
            log_bus: self.log_bus.snapshot(),
        }
    }
}

// ============================================================================
// Metrics Snapshot Types (Value Snapshots for Exporters & Serializers)
// ============================================================================

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HttpMetricsSnapshot {
    pub requests_total: u64,
    pub status_2xx: u64,
    pub status_3xx: u64,
    pub status_4xx: u64,
    pub status_5xx: u64,
    pub status_other: u64,

    pub duration_bucket_1ms: u64,
    pub duration_bucket_5ms: u64,
    pub duration_bucket_10ms: u64,
    pub duration_bucket_50ms: u64,
    pub duration_bucket_100ms: u64,
    pub duration_bucket_500ms: u64,
    pub duration_bucket_1000ms: u64,
    pub duration_bucket_inf: u64,
    pub duration_sum_ms: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct L7TrafficMetricsSnapshot {
    pub request_bytes_in: u64,
    pub response_bytes_out: u64,
    pub requests_ssl: u64,
    pub requests_matched: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConnectionMetricsSnapshot {
    pub active: u64,
    pub reading: u64,
    pub writing: u64,
    pub waiting: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SslMetricsSnapshot {
    pub handshakes_total: u64,
    pub handshakes_failed: u64,
    pub sessions_reused: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct UpstreamMetricsSnapshot {
    pub requests_total: u64,
    pub responses_2xx: u64,
    pub responses_5xx: u64,
    pub response_time_sum_ms: u64,
    pub connect_time_sum_ms: u64,
    pub failures: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IpRestrictionMetricsSnapshot {
    pub allow: u64,
    pub block: u64,
}

pub type AccessMetricsSnapshot = IpRestrictionMetricsSnapshot;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RateLimitMetricsSnapshot {
    pub allowed: u64,
    pub throttled: u64,
    pub rejected: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JwtMetricsSnapshot {
    pub valid: u64,
    pub invalid: u64,
    pub expired: u64,
    pub missing: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ConnLimitMetricsSnapshot {
    pub rejected: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TrafficShaperMetricsSnapshot {
    pub delayed: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RequestSizeMetricsSnapshot {
    pub rejected: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TerminationMetricsSnapshot {
    pub triggered: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TrafficSplitMetricsSnapshot {
    pub primary: u64,
    pub secondary: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CanaryMetricsSnapshot {
    pub baseline: u64,
    pub canary: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlueGreenMetricsSnapshot {
    pub blue: u64,
    pub green: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MirrorMetricsSnapshot {
    pub sampled: u64,
}

/// Plain value snapshot of all gateway metrics, safe for serialization or rendering.
/// Organized by network layer: L7 → L4 → Upstream → Extensions → Infra.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GatewayMetricsSnapshot {
    pub http: HttpMetricsSnapshot,
    pub l7_traffic: L7TrafficMetricsSnapshot,
    pub connections: ConnectionMetricsSnapshot,
    pub ssl: SslMetricsSnapshot,
    pub upstream: UpstreamMetricsSnapshot,
    pub ip_restriction: IpRestrictionMetricsSnapshot,
    pub ratelimit: RateLimitMetricsSnapshot,
    pub jwt: JwtMetricsSnapshot,
    pub conn_limit: ConnLimitMetricsSnapshot,
    pub traffic_shaper: TrafficShaperMetricsSnapshot,
    pub request_size: RequestSizeMetricsSnapshot,
    pub termination: TerminationMetricsSnapshot,
    pub traffic_split: TrafficSplitMetricsSnapshot,
    pub canary: CanaryMetricsSnapshot,
    pub blue_green: BlueGreenMetricsSnapshot,
    pub mirror: MirrorMetricsSnapshot,
    pub log_bus: LogBusMetricsSnapshot,
}

#[cfg(test)]
mod tests {
    use super::super::SHM_SIZE_BYTES;
    use super::*;

    #[test]
    fn test_shared_metrics_size_and_alignment() {
        assert_eq!(
            std::mem::size_of::<GatewaySharedMetrics>(),
            SHM_SIZE_BYTES,
            "GatewaySharedMetrics must be exactly 4096 bytes"
        );
        assert_eq!(
            std::mem::align_of::<GatewaySharedMetrics>(),
            8,
            "GatewaySharedMetrics must have 8-byte alignment"
        );
    }

    #[test]
    fn test_record_and_snapshot() {
        let metrics = GatewaySharedMetrics::new();
        metrics.record_http_request(200, 3);
        metrics.record_http_request(404, 15);
        metrics.record_http_request(500, 1500);

        metrics.record_traffic(1024, 4096, true, true);
        metrics.record_traffic(512, 2048, false, false);

        metrics.record_connections(42, 3, 7, 32);
        metrics.record_ssl(true, false);
        metrics.record_ssl(true, true);
        metrics.record_ssl(false, false);

        metrics.record_upstream(200, 50, 5, false);
        metrics.record_upstream(502, 0, 0, true);

        metrics.record_ip_restriction(1);
        metrics.record_ratelimit(2);
        metrics.record_jwt(0);

        assert!(!metrics.is_log_active());
        assert_eq!(metrics.register_log_consumer(), 1);
        assert!(metrics.is_log_active());
        assert_eq!(metrics.register_log_consumer(), 2);
        assert_eq!(metrics.unregister_log_consumer(), 1);
        assert!(metrics.is_log_active());

        let snap = metrics.snapshot();

        // L7 HTTP
        assert_eq!(snap.http.requests_total, 3);
        assert_eq!(snap.http.status_2xx, 1);
        assert_eq!(snap.http.status_4xx, 1);
        assert_eq!(snap.http.status_5xx, 1);
        assert_eq!(snap.http.duration_bucket_1ms, 0);
        assert_eq!(snap.http.duration_bucket_5ms, 1);
        assert_eq!(snap.http.duration_bucket_50ms, 2);
        assert_eq!(snap.http.duration_bucket_inf, 3);
        assert_eq!(snap.http.duration_sum_ms, 1518);

        // L7 Traffic
        assert_eq!(snap.l7_traffic.request_bytes_in, 1536);
        assert_eq!(snap.l7_traffic.response_bytes_out, 6144);
        assert_eq!(snap.l7_traffic.requests_ssl, 1);
        assert_eq!(snap.l7_traffic.requests_matched, 1);

        // L4 Connections
        assert_eq!(snap.connections.active, 42);
        assert_eq!(snap.connections.reading, 3);
        assert_eq!(snap.connections.writing, 7);
        assert_eq!(snap.connections.waiting, 32);

        // L4 SSL
        assert_eq!(snap.ssl.handshakes_total, 3);
        assert_eq!(snap.ssl.handshakes_failed, 1);
        assert_eq!(snap.ssl.sessions_reused, 1);

        // Upstream
        assert_eq!(snap.upstream.requests_total, 2);
        assert_eq!(snap.upstream.responses_2xx, 1);
        assert_eq!(snap.upstream.responses_5xx, 1);
        assert_eq!(snap.upstream.response_time_sum_ms, 50);
        assert_eq!(snap.upstream.connect_time_sum_ms, 5);
        assert_eq!(snap.upstream.failures, 1);

        // Extensions
        assert_eq!(snap.ip_restriction.block, 1);
        assert_eq!(snap.ratelimit.rejected, 1);
        assert_eq!(snap.jwt.valid, 1);

        // Infra
        assert_eq!(snap.log_bus.active_consumers, 1);

        assert_eq!(metrics.unregister_log_consumer(), 0);
        assert!(!metrics.is_log_active());
    }
}
