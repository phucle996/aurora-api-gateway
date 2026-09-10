use super::metrics::{MetricsManager, OtlpExporter, PrometheusExporter};
use crate::spec::{ExtensionsSpec, MetricsExtensionSpec};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;

/// Central Dispatcher for all Aurora Agent Extensions.
/// Manages runtime lifecycle: start, hot-reload, and graceful stop (Zero-Overhead).
pub struct ExtensionDispatcher {
    node_id: Arc<String>,
    metrics_shutdown: Option<CancellationToken>,
    last_metrics_spec: Option<MetricsExtensionSpec>,
}

impl ExtensionDispatcher {
    pub fn new(node_id: Arc<String>) -> Self {
        Self {
            node_id,
            metrics_shutdown: None,
            last_metrics_spec: None,
        }
    }

    /// Apply declarative extension configurations from NodeSpec.
    pub async fn apply_spec(&mut self, spec: &ExtensionsSpec) {
        self.dispatch_metrics(&spec.prometheus).await;
    }

    async fn dispatch_metrics(&mut self, metrics_spec: &Option<MetricsExtensionSpec>) {
        let is_active = match metrics_spec {
            Some(m) if m.enabled => {
                let prom_on = m.prometheus.as_ref().map(|p| p.enabled).unwrap_or(false);
                let otlp_on = m
                    .otlp
                    .as_ref()
                    .map(|o| o.enabled && !o.endpoint.trim().is_empty())
                    .unwrap_or(false);
                prom_on || otlp_on
            }
            _ => false,
        };

        if !is_active {
            // Extension disabled or unconfigured -> Stop runner to enforce Zero Overhead
            if let Some(cancel) = self.metrics_shutdown.take() {
                info!("Stopping 'metrics' extension (Zero-Overhead enforced)");
                cancel.cancel();
            }
            self.last_metrics_spec = None;
            return;
        }

        let m = metrics_spec.as_ref().unwrap();

        // Check if configuration is unchanged
        if self.metrics_shutdown.is_some() && self.last_metrics_spec.as_ref() == Some(m) {
            return;
        }

        // Configuration changed or not running -> Stop previous instance if any
        if let Some(cancel) = self.metrics_shutdown.take() {
            info!("Reloading 'metrics' extension with updated configuration");
            cancel.cancel();
        }

        // Spawn new metrics instance
        let shutdown = CancellationToken::new();
        let port = m.port;
        let node_id = Arc::clone(&self.node_id);
        let stub_url = m.stub_status_url.clone().unwrap_or_default();
        let prom_enabled = m.prometheus.as_ref().map(|p| p.enabled).unwrap_or(false);

        let (otlp_enabled, otlp_endpoint, otlp_interval) = if let Some(ref o) = m.otlp {
            (
                o.enabled && !o.endpoint.trim().is_empty(),
                o.endpoint.clone(),
                o.interval_secs,
            )
        } else {
            (false, String::new(), 15)
        };

        let metrics_shutdown_token = shutdown.clone();
        tokio::spawn(async move {
            let manager = MetricsManager::new(stub_url)
                .with_pull_exporter(Arc::new(PrometheusExporter::new(prom_enabled)))
                .with_push_exporter(Arc::new(OtlpExporter::new(
                    otlp_enabled,
                    otlp_endpoint,
                    otlp_interval,
                )));

            manager.run(port, node_id, metrics_shutdown_token).await;
        });

        self.metrics_shutdown = Some(shutdown);
        self.last_metrics_spec = Some(m.clone());
        info!(
            port = port,
            "Extension 'metrics' successfully started/dispatched"
        );
    }

    /// Shutdown all active running extensions.
    pub async fn shutdown_all(&mut self) {
        if let Some(cancel) = self.metrics_shutdown.take() {
            cancel.cancel();
        }
        self.last_metrics_spec = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dispatcher_lifecycle() {
        let node_id = Arc::new("node-01".to_string());
        let mut dispatcher = ExtensionDispatcher::new(node_id);

        let mut spec = ExtensionsSpec::default();
        // 1. Initial state: disabled -> no running extension
        dispatcher.apply_spec(&spec).await;
        assert!(dispatcher.metrics_shutdown.is_none());

        // 2. Enable metrics
        spec.prometheus = Some(MetricsExtensionSpec {
            enabled: true,
            port: 19145,
            stub_status_url: None,
            prometheus: Some(crate::spec::PrometheusSpec {
                enabled: true,
                path: "/metrics".to_string(),
            }),
            otlp: None,
        });

        dispatcher.apply_spec(&spec).await;
        assert!(dispatcher.metrics_shutdown.is_some());

        // 3. Disable metrics -> shuts down immediately
        spec.prometheus.as_mut().unwrap().enabled = false;
        dispatcher.apply_spec(&spec).await;
        assert!(dispatcher.metrics_shutdown.is_none());
    }
}
