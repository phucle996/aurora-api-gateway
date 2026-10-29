//! Dedicated Prometheus Metric Task Definition & Lock-Free Worker Counters.

use super::engine::PrometheusValues;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct HttpMetricTask {
    pub status: u16,
    pub duration_ms: u32,
    pub bytes_sent: u64,
    pub bytes_recv: u64,
    pub active_conns: u64,
    pub reading_conns: u64,
    pub writing_conns: u64,
    pub waiting_conns: u64,
}

/// Worker-local lock-free atomic counters for HTTP metrics.
///
/// Eliminates channel enqueue, heap allocation, and lock contention on the hot path.
/// Updated with relaxed atomics (< 3ns per request).
pub struct WorkerHttpMetrics {
    pub requests_2xx: AtomicU64,
    pub requests_3xx: AtomicU64,
    pub requests_4xx: AtomicU64,
    pub requests_5xx: AtomicU64,
    pub requests_other: AtomicU64,
    pub bytes_in: AtomicU64,
    pub bytes_out: AtomicU64,
    pub duration_sum_ms: AtomicU64,
    pub duration_buckets: [AtomicU64; 7],
    pub active_conns: AtomicU64,
    pub reading_conns: AtomicU64,
    pub writing_conns: AtomicU64,
    pub waiting_conns: AtomicU64,
}

impl Default for WorkerHttpMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkerHttpMetrics {
    pub const fn new() -> Self {
        Self {
            requests_2xx: AtomicU64::new(0),
            requests_3xx: AtomicU64::new(0),
            requests_4xx: AtomicU64::new(0),
            requests_5xx: AtomicU64::new(0),
            requests_other: AtomicU64::new(0),
            bytes_in: AtomicU64::new(0),
            bytes_out: AtomicU64::new(0),
            duration_sum_ms: AtomicU64::new(0),
            duration_buckets: [
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
                AtomicU64::new(0),
            ],
            active_conns: AtomicU64::new(0),
            reading_conns: AtomicU64::new(0),
            writing_conns: AtomicU64::new(0),
            waiting_conns: AtomicU64::new(0),
        }
    }

    #[inline(always)]
    pub fn record(&self, task: &HttpMetricTask) {
        match task.status {
            200..=299 => self.requests_2xx.fetch_add(1, Ordering::Relaxed),
            300..=399 => self.requests_3xx.fetch_add(1, Ordering::Relaxed),
            400..=499 => self.requests_4xx.fetch_add(1, Ordering::Relaxed),
            500..=599 => self.requests_5xx.fetch_add(1, Ordering::Relaxed),
            _ => self.requests_other.fetch_add(1, Ordering::Relaxed),
        };
        self.bytes_out.fetch_add(task.bytes_sent, Ordering::Relaxed);
        self.bytes_in.fetch_add(task.bytes_recv, Ordering::Relaxed);
        self.duration_sum_ms
            .fetch_add(task.duration_ms as u64, Ordering::Relaxed);

        let bucket_idx = match task.duration_ms {
            0..=1 => 0,
            2..=5 => 1,
            6..=10 => 2,
            11..=50 => 3,
            51..=100 => 4,
            101..=500 => 5,
            _ => 6,
        };
        self.duration_buckets[bucket_idx].fetch_add(1, Ordering::Relaxed);

        if task.active_conns > 0 {
            self.active_conns.store(task.active_conns, Ordering::Relaxed);
            self.reading_conns.store(task.reading_conns, Ordering::Relaxed);
            self.writing_conns.store(task.writing_conns, Ordering::Relaxed);
            self.waiting_conns.store(task.waiting_conns, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self) -> PrometheusValues {
        PrometheusValues {
            in_flight: 0,
            requests_2xx: self.requests_2xx.load(Ordering::Relaxed),
            requests_3xx: self.requests_3xx.load(Ordering::Relaxed),
            requests_4xx: self.requests_4xx.load(Ordering::Relaxed),
            requests_5xx: self.requests_5xx.load(Ordering::Relaxed),
            requests_other: self.requests_other.load(Ordering::Relaxed),
            duration_buckets: [
                self.duration_buckets[0].load(Ordering::Relaxed),
                self.duration_buckets[1].load(Ordering::Relaxed),
                self.duration_buckets[2].load(Ordering::Relaxed),
                self.duration_buckets[3].load(Ordering::Relaxed),
                self.duration_buckets[4].load(Ordering::Relaxed),
                self.duration_buckets[5].load(Ordering::Relaxed),
                self.duration_buckets[6].load(Ordering::Relaxed),
            ],
            duration_sum_ms: self.duration_sum_ms.load(Ordering::Relaxed),
            bytes_in: self.bytes_in.load(Ordering::Relaxed),
            bytes_out: self.bytes_out.load(Ordering::Relaxed),
            active_conns: self.active_conns.load(Ordering::Relaxed),
            reading_conns: self.reading_conns.load(Ordering::Relaxed),
            writing_conns: self.writing_conns.load(Ordering::Relaxed),
            waiting_conns: self.waiting_conns.load(Ordering::Relaxed),
            dropped_tasks: 0,
            cpu_utilization: 0.0,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
            memory_utilization: 0.0,
        }
    }
}

static GLOBAL_HTTP_METRICS: WorkerHttpMetrics = WorkerHttpMetrics::new();

#[inline(always)]
pub fn get_worker_http_metrics() -> &'static WorkerHttpMetrics {
    &GLOBAL_HTTP_METRICS
}

#[inline(always)]
pub fn record_http_metrics(task: &HttpMetricTask) {
    GLOBAL_HTTP_METRICS.record(task);
}
