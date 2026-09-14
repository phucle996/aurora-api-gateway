//! In-Process Zero-Overhead Gateway Telemetry and Shared Memory Metrics.
//!
//! Designed for lockless, zero-allocation recording on the HTTP request path.

use std::sync::atomic::{AtomicU64, Ordering};

pub const TELEMETRY_MAGIC: u32 = 0x4155524F; // "AURO"
pub const TELEMETRY_VERSION: u32 = 1;
pub const SHM_DEFAULT_PATH: &str = "/dev/shm/aurora_gateway_telemetry.bin";
pub const SHM_SIZE_BYTES: usize = 4096;

/// Fixed latency bucket upper bounds in milliseconds:
/// <= 1ms, <= 5ms, <= 10ms, <= 50ms, <= 100ms, <= 500ms, <= 1000ms
pub const LATENCY_BUCKETS_MS: [u64; 7] = [1, 5, 10, 50, 100, 500, 1000];

/// Padded lockless shared memory struct shared between NGINX workers and Aurora Agent.
///
/// Size is strictly aligned and padded to 4096 bytes (1 memory page).
#[repr(C)]
pub struct GatewaySharedMetrics {
    pub magic: u32,
    pub version: u32,
    pub generation: AtomicU64,

    // HTTP requests and status classes
    pub http_requests_total: AtomicU64,
    pub http_status_2xx: AtomicU64,
    pub http_status_3xx: AtomicU64,
    pub http_status_4xx: AtomicU64,
    pub http_status_5xx: AtomicU64,
    pub http_status_other: AtomicU64,

    // Latency histogram buckets (cumulative counts)
    pub http_duration_bucket_1ms: AtomicU64,
    pub http_duration_bucket_5ms: AtomicU64,
    pub http_duration_bucket_10ms: AtomicU64,
    pub http_duration_bucket_50ms: AtomicU64,
    pub http_duration_bucket_100ms: AtomicU64,
    pub http_duration_bucket_500ms: AtomicU64,
    pub http_duration_bucket_1000ms: AtomicU64,
    pub http_duration_bucket_inf: AtomicU64,
    pub http_duration_sum_ms: AtomicU64,

    // Core WAF
    pub waf_allow: AtomicU64,
    pub waf_block: AtomicU64,
    pub waf_audit: AtomicU64,

    // Access Control (IP/CIDR)
    pub access_allow: AtomicU64,
    pub access_block: AtomicU64,

    // Rate Limiting
    pub ratelimit_allowed: AtomicU64,
    pub ratelimit_throttled: AtomicU64,
    pub ratelimit_rejected: AtomicU64,

    // JWT Authentication
    pub jwt_valid: AtomicU64,
    pub jwt_invalid: AtomicU64,
    pub jwt_expired: AtomicU64,
    pub jwt_missing: AtomicU64,

    // Policy extensions
    pub conn_limit_rejected: AtomicU64,
    pub traffic_shaper_delayed: AtomicU64,
    pub request_size_rejected: AtomicU64,
    pub termination_triggered: AtomicU64,

    // Routing extensions
    pub traffic_split_primary: AtomicU64,
    pub traffic_split_secondary: AtomicU64,

    pub canary_baseline: AtomicU64,
    pub canary_canary: AtomicU64,

    pub blue_green_blue: AtomicU64,
    pub blue_green_green: AtomicU64,

    pub mirror_sampled: AtomicU64,

    // NGINX Connection state
    pub connections_active: AtomicU64,
    pub connections_reading: AtomicU64,
    pub connections_writing: AtomicU64,
    pub connections_waiting: AtomicU64,

    // Dynamic Log Consumer Registration
    pub active_log_consumers: AtomicU64,

    // Padding up to exactly 4096 bytes (360 bytes of fields + 3736 bytes padding)
    _reserved: [u8; 4096 - 360],
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
            http_requests_total: AtomicU64::new(0),
            http_status_2xx: AtomicU64::new(0),
            http_status_3xx: AtomicU64::new(0),
            http_status_4xx: AtomicU64::new(0),
            http_status_5xx: AtomicU64::new(0),
            http_status_other: AtomicU64::new(0),
            http_duration_bucket_1ms: AtomicU64::new(0),
            http_duration_bucket_5ms: AtomicU64::new(0),
            http_duration_bucket_10ms: AtomicU64::new(0),
            http_duration_bucket_50ms: AtomicU64::new(0),
            http_duration_bucket_100ms: AtomicU64::new(0),
            http_duration_bucket_500ms: AtomicU64::new(0),
            http_duration_bucket_1000ms: AtomicU64::new(0),
            http_duration_bucket_inf: AtomicU64::new(0),
            http_duration_sum_ms: AtomicU64::new(0),
            waf_allow: AtomicU64::new(0),
            waf_block: AtomicU64::new(0),
            waf_audit: AtomicU64::new(0),
            access_allow: AtomicU64::new(0),
            access_block: AtomicU64::new(0),
            ratelimit_allowed: AtomicU64::new(0),
            ratelimit_throttled: AtomicU64::new(0),
            ratelimit_rejected: AtomicU64::new(0),
            jwt_valid: AtomicU64::new(0),
            jwt_invalid: AtomicU64::new(0),
            jwt_expired: AtomicU64::new(0),
            jwt_missing: AtomicU64::new(0),
            conn_limit_rejected: AtomicU64::new(0),
            traffic_shaper_delayed: AtomicU64::new(0),
            request_size_rejected: AtomicU64::new(0),
            termination_triggered: AtomicU64::new(0),
            traffic_split_primary: AtomicU64::new(0),
            traffic_split_secondary: AtomicU64::new(0),
            canary_baseline: AtomicU64::new(0),
            canary_canary: AtomicU64::new(0),
            blue_green_blue: AtomicU64::new(0),
            blue_green_green: AtomicU64::new(0),
            mirror_sampled: AtomicU64::new(0),
            connections_active: AtomicU64::new(0),
            connections_reading: AtomicU64::new(0),
            connections_writing: AtomicU64::new(0),
            connections_waiting: AtomicU64::new(0),
            active_log_consumers: AtomicU64::new(0),
            _reserved: [0u8; 4096 - 360],
        }
    }

    /// Initializes header fields if uninitialized.
    pub fn ensure_header(&mut self) {
        if self.magic != TELEMETRY_MAGIC {
            self.magic = TELEMETRY_MAGIC;
            self.version = TELEMETRY_VERSION;
        }
    }

    /// Record completed HTTP request status code and duration in milliseconds.
    ///
    /// Executes in ~1-2 nanoseconds with zero heap allocations.
    #[inline(always)]
    pub fn record_http_request(&self, status: u32, duration_ms: u64) {
        self.http_requests_total.fetch_add(1, Ordering::Relaxed);
        match status {
            200..=299 => self.http_status_2xx.fetch_add(1, Ordering::Relaxed),
            300..=399 => self.http_status_3xx.fetch_add(1, Ordering::Relaxed),
            400..=499 => self.http_status_4xx.fetch_add(1, Ordering::Relaxed),
            500..=599 => self.http_status_5xx.fetch_add(1, Ordering::Relaxed),
            _ => self.http_status_other.fetch_add(1, Ordering::Relaxed),
        };

        // Cumulative histogram buckets
        if duration_ms <= 1 {
            self.http_duration_bucket_1ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 5 {
            self.http_duration_bucket_5ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 10 {
            self.http_duration_bucket_10ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 50 {
            self.http_duration_bucket_50ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 100 {
            self.http_duration_bucket_100ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 500 {
            self.http_duration_bucket_500ms
                .fetch_add(1, Ordering::Relaxed);
        }
        if duration_ms <= 1000 {
            self.http_duration_bucket_1000ms
                .fetch_add(1, Ordering::Relaxed);
        }
        self.http_duration_bucket_inf
            .fetch_add(1, Ordering::Relaxed);
        self.http_duration_sum_ms
            .fetch_add(duration_ms, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_waf(&self, action: u32) {
        match action {
            0 => self.waf_allow.fetch_add(1, Ordering::Relaxed),
            1 => self.waf_block.fetch_add(1, Ordering::Relaxed),
            _ => self.waf_audit.fetch_add(1, Ordering::Relaxed),
        };
    }

    #[inline(always)]
    pub fn record_access(&self, action: u32) {
        if action == 1 {
            self.access_block.fetch_add(1, Ordering::Relaxed);
        } else {
            self.access_allow.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_ratelimit(&self, action: u32) {
        match action {
            0 => self.ratelimit_allowed.fetch_add(1, Ordering::Relaxed),
            1 => self.ratelimit_throttled.fetch_add(1, Ordering::Relaxed),
            _ => self.ratelimit_rejected.fetch_add(1, Ordering::Relaxed),
        };
    }

    #[inline(always)]
    pub fn record_jwt(&self, status: u32) {
        match status {
            0 => self.jwt_valid.fetch_add(1, Ordering::Relaxed),
            1 => self.jwt_invalid.fetch_add(1, Ordering::Relaxed),
            2 => self.jwt_expired.fetch_add(1, Ordering::Relaxed),
            _ => self.jwt_missing.fetch_add(1, Ordering::Relaxed),
        };
    }

    #[inline(always)]
    pub fn record_conn_limit(&self, blocked: bool) {
        if blocked {
            self.conn_limit_rejected.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_traffic_shaper(&self, delayed: bool) {
        if delayed {
            self.traffic_shaper_delayed.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_request_size(&self, rejected: bool) {
        if rejected {
            self.request_size_rejected.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_termination(&self) {
        self.termination_triggered.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_traffic_split(&self, secondary: bool) {
        if secondary {
            self.traffic_split_secondary.fetch_add(1, Ordering::Relaxed);
        } else {
            self.traffic_split_primary.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_canary(&self, is_canary: bool) {
        if is_canary {
            self.canary_canary.fetch_add(1, Ordering::Relaxed);
        } else {
            self.canary_baseline.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_blue_green(&self, is_green: bool) {
        if is_green {
            self.blue_green_green.fetch_add(1, Ordering::Relaxed);
        } else {
            self.blue_green_blue.fetch_add(1, Ordering::Relaxed);
        }
    }

    #[inline(always)]
    pub fn record_mirror(&self) {
        self.mirror_sampled.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn record_connections(&self, active: u64, reading: u64, writing: u64, waiting: u64) {
        self.connections_active.store(active, Ordering::Relaxed);
        self.connections_reading.store(reading, Ordering::Relaxed);
        self.connections_writing.store(writing, Ordering::Relaxed);
        self.connections_waiting.store(waiting, Ordering::Relaxed);
    }

    /// Register an active log consumer. Returns the updated consumer count.
    #[inline(always)]
    pub fn register_log_consumer(&self) -> u64 {
        self.active_log_consumers.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Unregister an active log consumer. Returns the updated consumer count.
    #[inline(always)]
    pub fn unregister_log_consumer(&self) -> u64 {
        loop {
            let current = self.active_log_consumers.load(Ordering::SeqCst);
            if current == 0 {
                return 0;
            }
            let next = current - 1;
            if self
                .active_log_consumers
                .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return next;
            }
        }
    }

    /// Check if at least one log consumer is active.
    #[inline(always)]
    pub fn is_log_active(&self) -> bool {
        self.active_log_consumers.load(Ordering::Relaxed) > 0
    }

    /// Returns the current active log consumers count.
    #[inline(always)]
    pub fn active_log_consumers_count(&self) -> u64 {
        self.active_log_consumers.load(Ordering::Relaxed)
    }

    /// Resets active log consumers count to 0 (useful on agent startup/recovery).
    #[inline(always)]
    pub fn reset_log_consumers(&self) {
        self.active_log_consumers.store(0, Ordering::SeqCst);
    }

    /// Read non-blocking snapshot of all metrics for Prometheus formatting.
    pub fn snapshot(&self) -> GatewayMetricsSnapshot {
        GatewayMetricsSnapshot {
            http_requests_total: self.http_requests_total.load(Ordering::Relaxed),
            http_status_2xx: self.http_status_2xx.load(Ordering::Relaxed),
            http_status_3xx: self.http_status_3xx.load(Ordering::Relaxed),
            http_status_4xx: self.http_status_4xx.load(Ordering::Relaxed),
            http_status_5xx: self.http_status_5xx.load(Ordering::Relaxed),
            http_status_other: self.http_status_other.load(Ordering::Relaxed),

            http_duration_bucket_1ms: self.http_duration_bucket_1ms.load(Ordering::Relaxed),
            http_duration_bucket_5ms: self.http_duration_bucket_5ms.load(Ordering::Relaxed),
            http_duration_bucket_10ms: self.http_duration_bucket_10ms.load(Ordering::Relaxed),
            http_duration_bucket_50ms: self.http_duration_bucket_50ms.load(Ordering::Relaxed),
            http_duration_bucket_100ms: self.http_duration_bucket_100ms.load(Ordering::Relaxed),
            http_duration_bucket_500ms: self.http_duration_bucket_500ms.load(Ordering::Relaxed),
            http_duration_bucket_1000ms: self.http_duration_bucket_1000ms.load(Ordering::Relaxed),
            http_duration_bucket_inf: self.http_duration_bucket_inf.load(Ordering::Relaxed),
            http_duration_sum_ms: self.http_duration_sum_ms.load(Ordering::Relaxed),

            waf_allow: self.waf_allow.load(Ordering::Relaxed),
            waf_block: self.waf_block.load(Ordering::Relaxed),
            waf_audit: self.waf_audit.load(Ordering::Relaxed),

            access_allow: self.access_allow.load(Ordering::Relaxed),
            access_block: self.access_block.load(Ordering::Relaxed),

            ratelimit_allowed: self.ratelimit_allowed.load(Ordering::Relaxed),
            ratelimit_throttled: self.ratelimit_throttled.load(Ordering::Relaxed),
            ratelimit_rejected: self.ratelimit_rejected.load(Ordering::Relaxed),

            jwt_valid: self.jwt_valid.load(Ordering::Relaxed),
            jwt_invalid: self.jwt_invalid.load(Ordering::Relaxed),
            jwt_expired: self.jwt_expired.load(Ordering::Relaxed),
            jwt_missing: self.jwt_missing.load(Ordering::Relaxed),

            conn_limit_rejected: self.conn_limit_rejected.load(Ordering::Relaxed),
            traffic_shaper_delayed: self.traffic_shaper_delayed.load(Ordering::Relaxed),
            request_size_rejected: self.request_size_rejected.load(Ordering::Relaxed),
            termination_triggered: self.termination_triggered.load(Ordering::Relaxed),

            traffic_split_primary: self.traffic_split_primary.load(Ordering::Relaxed),
            traffic_split_secondary: self.traffic_split_secondary.load(Ordering::Relaxed),

            canary_baseline: self.canary_baseline.load(Ordering::Relaxed),
            canary_canary: self.canary_canary.load(Ordering::Relaxed),

            blue_green_blue: self.blue_green_blue.load(Ordering::Relaxed),
            blue_green_green: self.blue_green_green.load(Ordering::Relaxed),

            mirror_sampled: self.mirror_sampled.load(Ordering::Relaxed),

            connections_active: self.connections_active.load(Ordering::Relaxed),
            connections_reading: self.connections_reading.load(Ordering::Relaxed),
            connections_writing: self.connections_writing.load(Ordering::Relaxed),
            connections_waiting: self.connections_waiting.load(Ordering::Relaxed),
            active_log_consumers: self.active_log_consumers.load(Ordering::Relaxed),
        }
    }
}

/// Plain value snapshot of all gateway metrics, safe for serialization or rendering.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct GatewayMetricsSnapshot {
    pub http_requests_total: u64,
    pub http_status_2xx: u64,
    pub http_status_3xx: u64,
    pub http_status_4xx: u64,
    pub http_status_5xx: u64,
    pub http_status_other: u64,

    pub http_duration_bucket_1ms: u64,
    pub http_duration_bucket_5ms: u64,
    pub http_duration_bucket_10ms: u64,
    pub http_duration_bucket_50ms: u64,
    pub http_duration_bucket_100ms: u64,
    pub http_duration_bucket_500ms: u64,
    pub http_duration_bucket_1000ms: u64,
    pub http_duration_bucket_inf: u64,
    pub http_duration_sum_ms: u64,

    pub waf_allow: u64,
    pub waf_block: u64,
    pub waf_audit: u64,

    pub access_allow: u64,
    pub access_block: u64,

    pub ratelimit_allowed: u64,
    pub ratelimit_throttled: u64,
    pub ratelimit_rejected: u64,

    pub jwt_valid: u64,
    pub jwt_invalid: u64,
    pub jwt_expired: u64,
    pub jwt_missing: u64,

    pub conn_limit_rejected: u64,
    pub traffic_shaper_delayed: u64,
    pub request_size_rejected: u64,
    pub termination_triggered: u64,

    pub traffic_split_primary: u64,
    pub traffic_split_secondary: u64,

    pub canary_baseline: u64,
    pub canary_canary: u64,

    pub blue_green_blue: u64,
    pub blue_green_green: u64,

    pub mirror_sampled: u64,

    pub connections_active: u64,
    pub connections_reading: u64,
    pub connections_writing: u64,
    pub connections_waiting: u64,
    pub active_log_consumers: u64,
}

#[cfg(test)]
mod tests {
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

        metrics.record_waf(1);
        metrics.record_ratelimit(2);
        metrics.record_jwt(0);
        metrics.record_connections(42, 3, 7, 32);

        assert!(!metrics.is_log_active());
        assert_eq!(metrics.register_log_consumer(), 1);
        assert!(metrics.is_log_active());
        assert_eq!(metrics.register_log_consumer(), 2);
        assert_eq!(metrics.unregister_log_consumer(), 1);
        assert!(metrics.is_log_active());

        let snap = metrics.snapshot();
        assert_eq!(snap.http_requests_total, 3);
        assert_eq!(snap.http_status_2xx, 1);
        assert_eq!(snap.http_status_4xx, 1);
        assert_eq!(snap.http_status_5xx, 1);

        assert_eq!(snap.http_duration_bucket_1ms, 0);
        assert_eq!(snap.http_duration_bucket_5ms, 1); // <= 5ms contains the 3ms request
        assert_eq!(snap.http_duration_bucket_50ms, 2); // contains 3ms and 15ms requests
        assert_eq!(snap.http_duration_bucket_inf, 3); // all 3 requests
        assert_eq!(snap.http_duration_sum_ms, 1518);

        assert_eq!(snap.waf_block, 1);
        assert_eq!(snap.ratelimit_rejected, 1);
        assert_eq!(snap.jwt_valid, 1);

        assert_eq!(snap.connections_active, 42);
        assert_eq!(snap.connections_reading, 3);
        assert_eq!(snap.connections_writing, 7);
        assert_eq!(snap.connections_waiting, 32);
        assert_eq!(snap.active_log_consumers, 1);

        assert_eq!(metrics.unregister_log_consumer(), 0);
        assert!(!metrics.is_log_active());
        assert_eq!(metrics.unregister_log_consumer(), 0); // safe underflow protection
    }
}
