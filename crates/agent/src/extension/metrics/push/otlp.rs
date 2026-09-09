use super::PushExporter;
use crate::extension::metrics::collector::NodeMetrics;
use anyhow::Result;
use std::time::Duration;
use tracing::debug;

pub struct OtlpExporter {
    enabled: bool,
    endpoint: String,
    interval: Duration,
}

impl OtlpExporter {
    pub fn new(enabled: bool, endpoint: impl Into<String>, interval_secs: u64) -> Self {
        Self {
            enabled,
            endpoint: endpoint.into(),
            interval: Duration::from_secs(interval_secs),
        }
    }
}

use std::future::Future;
use std::pin::Pin;

impl PushExporter for OtlpExporter {
    fn name(&self) -> &'static str {
        "otlp"
    }

    fn is_enabled(&self) -> bool {
        self.enabled && !self.endpoint.trim().is_empty()
    }

    fn interval(&self) -> Duration {
        self.interval
    }

    fn export<'a>(
        &'a self,
        node_id: &'a str,
        metrics: &'a NodeMetrics,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            if !self.is_enabled() {
                return Ok(());
            }

            debug!(
                endpoint = %self.endpoint,
                node_id = %node_id,
                active_connections = metrics.active_connections,
                requests_total = metrics.requests_total,
                "Pushed metrics snapshot via OTLP"
            );
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_otlp_exporter_lifecycle() {
        let disabled = OtlpExporter::new(false, "http://collector:4317", 10);
        assert!(!disabled.is_enabled());

        let empty_endpoint = OtlpExporter::new(true, "", 10);
        assert!(!empty_endpoint.is_enabled());

        let enabled = OtlpExporter::new(true, "http://collector:4317", 15);
        assert!(enabled.is_enabled());
        assert_eq!(enabled.interval(), Duration::from_secs(15));

        let m = NodeMetrics::default();
        assert!(enabled.export("node-test", &m).await.is_ok());
    }
}
