//! Prometheus Exporter Plugin Subsystem.

pub mod engine;
pub mod plugin;
pub mod task;

pub use engine::*;
pub use plugin::PrometheusPlugin;
pub use task::HttpMetricTask;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_precomputed_prometheus_render() {
        let engine = PrecomputedPrometheusEngine::new("test-gateway", "node-test");

        let values = PrometheusValues {
            in_flight: 42,
            requests_2xx: 1000,
            requests_3xx: 50,
            requests_4xx: 10,
            requests_5xx: 2,
            requests_other: 0,
            duration_buckets: [500, 300, 150, 40, 10, 2, 0],
            duration_sum_ms: 12500,
            bytes_in: 102400,
            bytes_out: 204800,
            active_conns: 50,
            reading_conns: 10,
            writing_conns: 30,
            waiting_conns: 10,
            cpu_utilization: 0.25,
            memory_used_bytes: 4294967296,
            memory_total_bytes: 17179869184,
            memory_utilization: 0.25,
        };

        engine.update_values(values);
        let scrape = engine.render_scrape(42);
        let text = std::str::from_utf8(&scrape).expect("valid utf-8");

        assert!(text.contains("gateway_requests_in_flight 42"));
        assert!(text.contains("status=\"2xx\"} 1000"));
        assert!(text.contains("status=\"5xx\"} 2"));
        assert!(text.contains("direction=\"in\"} 102400"));
        assert!(text.contains("le=\"0.001\"} 500"));
        assert!(text.contains("gateway_request_duration_seconds_sum 12.500"));
        assert!(text.contains("system_cpu_utilization_ratio 0.250"));
        assert!(text.contains("system_memory_used_bytes 4294967296"));
        assert!(text.contains("system_memory_total_bytes 17179869184"));
    }
}
