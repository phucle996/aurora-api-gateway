//! In-process Telemetry, Shared Memory Counters, and Prometheus Formatting.
//!
//! Note: All network synchronization, heartbeats, and spec materialization
//! are handled out-of-process by aurora-agent. The FFI layer remains strictly
//! in-memory and data-plane only.

pub mod prometheus;
pub mod sampler;
pub mod state;

pub use prometheus::format_prometheus_metrics;
pub use state::{bind, record_evaluation};

pub fn stop_telemetry() {
    state::TELEMETRY_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prometheus_formatting() {
        record_evaluation(0);
        record_evaluation(1);
        let text = format_prometheus_metrics("test-node-01");
        assert!(
            text.contains(
                "aurora_waf_evaluations_total{action=\"allow\",node_id=\"test-node-01\"}"
            )
        );
        assert!(
            text.contains(
                "aurora_waf_evaluations_total{action=\"block\",node_id=\"test-node-01\"}"
            )
        );
        assert!(text.contains("# TYPE aurora_node_cpu_percent gauge"));
        assert!(!text.contains("} 5.00"));
    }
}
