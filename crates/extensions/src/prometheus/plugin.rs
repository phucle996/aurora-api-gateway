//! Dedicated Prometheus Background Plugin.
//!
//! Accumulates HTTP metric counters and periodically samples Node OS metrics
//! to update the precomputed Prometheus exposition engine.

use super::engine::{PrometheusValues, get_prometheus_engine};
use super::task::HttpMetricTask;
use crate::metrics::node::CpuStatSampler;
use std::time::Instant;

/// Background telemetry plugin that accumulates HTTP metric counters
/// and periodically samples Node OS metrics to update the precomputed Prometheus exposition engine.
pub struct PrometheusPlugin {
    prom_values: PrometheusValues,
    cpu_sampler: CpuStatSampler,
    last_os_sample: Instant,
    dirty: bool,
}

impl PrometheusPlugin {
    pub fn new() -> Self {
        Self {
            prom_values: PrometheusValues::default(),
            cpu_sampler: CpuStatSampler::new(),
            last_os_sample: Instant::now(),
            dirty: false,
        }
    }

    pub fn values(&self) -> &PrometheusValues {
        &self.prom_values
    }

    pub fn handle_task(&mut self, task: &HttpMetricTask) {
        match task.status {
            200..=299 => self.prom_values.requests_2xx += 1,
            300..=399 => self.prom_values.requests_3xx += 1,
            400..=499 => self.prom_values.requests_4xx += 1,
            500..=599 => self.prom_values.requests_5xx += 1,
            _ => self.prom_values.requests_other += 1,
        }
        self.prom_values.bytes_in += task.bytes_recv;
        self.prom_values.bytes_out += task.bytes_sent;
        self.prom_values.duration_sum_ms += task.duration_ms as u64;

        match task.duration_ms {
            0..=1 => self.prom_values.duration_buckets[0] += 1,
            2..=5 => self.prom_values.duration_buckets[1] += 1,
            6..=10 => self.prom_values.duration_buckets[2] += 1,
            11..=50 => self.prom_values.duration_buckets[3] += 1,
            51..=100 => self.prom_values.duration_buckets[4] += 1,
            101..=500 => self.prom_values.duration_buckets[5] += 1,
            _ => self.prom_values.duration_buckets[6] += 1,
        }

        if task.active_conns > 0 {
            self.prom_values.active_conns = task.active_conns;
            self.prom_values.reading_conns = task.reading_conns;
            self.prom_values.writing_conns = task.writing_conns;
            self.prom_values.waiting_conns = task.waiting_conns;
        }

        self.dirty = true;
    }

    pub fn tick(&mut self) {
        if self.last_os_sample.elapsed() >= std::time::Duration::from_secs(1) {
            self.sample_os_metrics();
        } else if self.dirty {
            get_prometheus_engine().update_values(self.prom_values);
            self.dirty = false;
        }
    }

    pub fn flush(&mut self) {
        if self.dirty {
            get_prometheus_engine().update_values(self.prom_values);
            self.dirty = false;
        }
    }

    fn sample_os_metrics(&mut self) {
        let os_metrics = crate::metrics::sample_node_metrics(&mut self.cpu_sampler);
        self.prom_values.cpu_utilization = os_metrics.cpu_utilization;
        self.prom_values.memory_used_bytes = os_metrics.memory_used_bytes;
        self.prom_values.memory_total_bytes = os_metrics.memory_total_bytes;
        self.prom_values.memory_utilization = os_metrics.memory_utilization;
        get_prometheus_engine().update_values(self.prom_values);
        self.last_os_sample = Instant::now();
        self.dirty = false;
    }
}

impl Default for PrometheusPlugin {
    fn default() -> Self {
        Self::new()
    }
}
