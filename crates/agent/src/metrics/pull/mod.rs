pub mod prometheus;

use super::collector::NodeMetrics;
pub use prometheus::PrometheusExporter;

/// Trait defining the contract for PULL-based metrics exporters (HTTP scraping).
pub trait PullExporter: Send + Sync {
    /// Identifier name of the exporter (e.g. "prometheus")
    fn name(&self) -> &'static str;

    /// Whether this exporter is actively enabled
    fn is_enabled(&self) -> bool;

    /// Primary HTTP path to serve metrics (e.g. "/metrics/prometheus")
    fn endpoint_path(&self) -> &'static str;

    /// Render live metrics on-demand upon incoming HTTP scrape request.
    /// Returns (response_body, content_type).
    fn render(&self, node_id: &str, metrics: &NodeMetrics) -> (String, &'static str);
}
