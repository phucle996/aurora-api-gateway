use super::PullExporter;
use crate::extension::metrics::collector::{format_prometheus, NodeMetrics};

pub struct PrometheusExporter {
    enabled: bool,
}

impl PrometheusExporter {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }
}

impl PullExporter for PrometheusExporter {
    fn name(&self) -> &'static str {
        "prometheus"
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn endpoint_path(&self) -> &'static str {
        "/metrics/prometheus"
    }

    fn render(&self, node_id: &str, metrics: &NodeMetrics) -> (String, &'static str) {
        (
            format_prometheus(node_id, metrics),
            "text/plain; version=0.0.4; charset=utf-8",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prometheus_pull_exporter_metadata() {
        let exp = PrometheusExporter::new(true);
        assert_eq!(exp.name(), "prometheus");
        assert!(exp.is_enabled());
        assert_eq!(exp.endpoint_path(), "/metrics/prometheus");

        let metrics = NodeMetrics {
            active_connections: 120,
            ..Default::default()
        };
        let (body, content_type) = exp.render("node-x", &metrics);
        assert!(body.contains("http_connections_active{node_id=\"node-x\"} 120"));
        assert!(content_type.contains("text/plain"));
    }
}
