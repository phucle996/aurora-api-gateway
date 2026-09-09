pub mod otlp;

use super::collector::NodeMetrics;
pub use otlp::OtlpExporter;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

/// Trait defining the contract for PUSH-based metrics exporters (periodic export to remote collectors).
pub trait PushExporter: Send + Sync {
    /// Identifier name of the exporter (e.g. "otlp")
    fn name(&self) -> &'static str;

    /// Whether this exporter is actively enabled
    fn is_enabled(&self) -> bool;

    /// Sampling / Push interval (e.g. 10s, 15s)
    fn interval(&self) -> Duration;

    /// Push collected metrics snapshot to the remote sink
    fn export<'a>(
        &'a self,
        node_id: &'a str,
        metrics: &'a NodeMetrics,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + 'a>>;
}
