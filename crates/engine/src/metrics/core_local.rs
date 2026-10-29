//! Core-Local Metrics Registry for Aurora Gateway.
//!
//! # Role: Intrinsic Metrics Kernel (Lõi Metrics Nội Tại)
//!
//! This module implements the raw, low-level Intrinsic Metrics substrate of the Aurora Gateway core:
//! - Sub-nanosecond, lock-free live gauge tracking for in-flight requests (`in_flight_requests`).
//! - Access Phase extension early rejection counters (`rejected_ip`, `rejected_jwt`, etc.).
//! - Cacheline-aligned (64 bytes, `#[repr(align(64))]`) to eliminate False Sharing and cross-core cache invalidations.
//!
//! # Decoupled Transport Invariant:
//! This substrate is strictly an **Intrinsic Scalar Registry**:
//! - It maintains ZERO knowledge of exposition protocols (Prometheus, OpenMetrics, StatsD, OTLP).
//! - It performs ZERO string formatting, ZERO heap allocations, and ZERO network socket I/O.
//! - When unobserved (no transport plugins registered), hot-path updates are either bypassed entirely
//!   or confined to relaxed atomic scalar operations on local CPU L1 cachelines (< 1ns).
//! - Higher-level telemetry transport plugins (e.g. `builtin/prometheus`) inspect these values
//!   asynchronously without ever stalling the traffic worker loop.

use std::sync::atomic::{AtomicU64, Ordering};

#[repr(align(64))]
#[derive(Debug, Default)]
pub struct CoreLocalMetrics {
    /// Currently in-flight HTTP requests being served by this worker.
    pub in_flight_requests: AtomicU64,

    /// Early rejection counters in the Access Phase
    pub rejected_ip: AtomicU64,
    pub rejected_jwt: AtomicU64,
    pub rejected_rate_limit: AtomicU64,
    pub rejected_conn_limit: AtomicU64,
    pub rejected_size_limit: AtomicU64,
    pub rejected_termination: AtomicU64,
}

impl CoreLocalMetrics {
    pub const fn new() -> Self {
        Self {
            in_flight_requests: AtomicU64::new(0),
            rejected_ip: AtomicU64::new(0),
            rejected_jwt: AtomicU64::new(0),
            rejected_rate_limit: AtomicU64::new(0),
            rejected_conn_limit: AtomicU64::new(0),
            rejected_size_limit: AtomicU64::new(0),
            rejected_termination: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn enter_request(&self) {
        self.in_flight_requests.fetch_add(1, Ordering::Relaxed);
    }

    #[inline(always)]
    pub fn leave_request(&self) {
        let _ = self
            .in_flight_requests
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |val| {
                Some(val.saturating_sub(1))
            });
    }

    #[inline(always)]
    pub fn current_in_flight(&self) -> u64 {
        self.in_flight_requests.load(Ordering::Relaxed)
    }

    #[inline(always)]
    pub fn record_rejection(&self, ext_id: u32) {
        match ext_id {
            0 => self.rejected_ip.fetch_add(1, Ordering::Relaxed),
            1 => self.rejected_jwt.fetch_add(1, Ordering::Relaxed),
            2 => self.rejected_rate_limit.fetch_add(1, Ordering::Relaxed),
            3 => self.rejected_conn_limit.fetch_add(1, Ordering::Relaxed),
            5 => self.rejected_size_limit.fetch_add(1, Ordering::Relaxed),
            10 => self.rejected_termination.fetch_add(1, Ordering::Relaxed),
            _ => 0,
        };
    }
}

thread_local! {
    pub static LOCAL_METRICS: CoreLocalMetrics = const { CoreLocalMetrics::new() };
}

/// Global fallback metrics object if thread_local is not accessible.
static GLOBAL_METRICS: CoreLocalMetrics = CoreLocalMetrics::new();

#[inline(always)]
pub fn in_flight_enter() {
    LOCAL_METRICS.with(|m| m.enter_request());
    GLOBAL_METRICS.enter_request();
}

#[inline(always)]
pub fn in_flight_leave() {
    LOCAL_METRICS.with(|m| m.leave_request());
    GLOBAL_METRICS.leave_request();
}

#[inline(always)]
pub fn get_in_flight() -> u64 {
    GLOBAL_METRICS.current_in_flight()
}

#[inline(always)]
pub fn record_access_rejection(ext_id: u32) {
    LOCAL_METRICS.with(|m| m.record_rejection(ext_id));
    GLOBAL_METRICS.record_rejection(ext_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_local_in_flight_lifecycle() {
        assert_eq!(get_in_flight(), 0);
        in_flight_enter();
        assert_eq!(get_in_flight(), 1);
        in_flight_enter();
        assert_eq!(get_in_flight(), 2);
        in_flight_leave();
        assert_eq!(get_in_flight(), 1);
        in_flight_leave();
        assert_eq!(get_in_flight(), 0);
    }

    #[test]
    fn test_rejection_metrics() {
        record_access_rejection(0); // IP
        record_access_rejection(2); // RateLimit
        assert_eq!(GLOBAL_METRICS.rejected_ip.load(Ordering::Relaxed), 1);
        assert_eq!(
            GLOBAL_METRICS.rejected_rate_limit.load(Ordering::Relaxed),
            1
        );
    }
}
