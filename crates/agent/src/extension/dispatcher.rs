use super::metrics::{MetricsManager, OtlpExporter, PrometheusExporter};
use crate::spec::extensions::{ExtensionInstanceSpec, MetricsExtensionSpec};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;

/// Owns extension processes that run outside NGINX. NGINX extensions are
/// materialized from the same instance envelopes before this dispatcher runs.
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

    pub async fn apply_spec(&mut self, instances: &[ExtensionInstanceSpec]) -> Result<(), String> {
        let mut metrics = None;
        for instance in instances {
            if instance.renderer != "agent-metrics" {
                continue;
            }
            if metrics.is_some() {
                return Err("NodeSpec contains more than one agent-metrics extension".to_string());
            }
            metrics = Some(
                serde_json::from_str::<MetricsExtensionSpec>(&instance.config_json).map_err(
                    |error| {
                        format!(
                            "decode metrics extension instance {} config: {error}",
                            instance.instance_id
                        )
                    },
                )?,
            );
        }
        self.dispatch_metrics(metrics.as_ref()).await;
        Ok(())
    }

    async fn dispatch_metrics(&mut self, metrics_spec: Option<&MetricsExtensionSpec>) {
        let is_active = metrics_spec.is_some_and(|metrics| {
            metrics
                .prometheus
                .as_ref()
                .is_some_and(|prometheus| prometheus.enabled)
                || metrics
                    .otlp
                    .as_ref()
                    .is_some_and(|otlp| otlp.enabled && !otlp.endpoint.trim().is_empty())
        });

        if !is_active {
            if let Some(cancel) = self.metrics_shutdown.take() {
                info!("Stopping metrics extension");
                cancel.cancel();
            }
            self.last_metrics_spec = None;
            return;
        }

        let metrics = metrics_spec.expect("active metrics extension");
        if self.metrics_shutdown.is_some() && self.last_metrics_spec.as_ref() == Some(metrics) {
            return;
        }
        if let Some(cancel) = self.metrics_shutdown.take() {
            info!("Reloading metrics extension with updated configuration");
            cancel.cancel();
        }

        let shutdown = CancellationToken::new();
        let node_id = Arc::clone(&self.node_id);
        let stub_url = metrics.stub_status_url.clone().unwrap_or_default();
        let pull_enabled = metrics
            .prometheus
            .as_ref()
            .is_some_and(|prometheus| prometheus.enabled);
        let (push_enabled, endpoint, interval_secs) =
            metrics
                .otlp
                .as_ref()
                .map_or((false, String::new(), 15), |otlp| {
                    (
                        otlp.enabled && !otlp.endpoint.trim().is_empty(),
                        otlp.endpoint.clone(),
                        otlp.interval_secs,
                    )
                });

        let shutdown_token = shutdown.clone();
        let port = metrics.port;
        tokio::spawn(async move {
            let manager = MetricsManager::new(stub_url)
                .with_pull_exporter(Arc::new(PrometheusExporter::new(pull_enabled)))
                .with_push_exporter(Arc::new(OtlpExporter::new(
                    push_enabled,
                    endpoint,
                    interval_secs,
                )));
            manager.run(port, node_id, shutdown_token).await;
        });
        self.metrics_shutdown = Some(shutdown);
        self.last_metrics_spec = Some(metrics.clone());
        info!(port, "Metrics extension started");
    }

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
    use crate::spec::extensions::ExtensionInstanceSpec;

    #[tokio::test]
    async fn dispatcher_starts_and_stops_metrics_from_manifest_instance() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()));
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "prometheus".to_string(),
            key: "builtin/prometheus".to_string(),
            version: 1,
            renderer: "agent-metrics".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"port":19145,"prometheus":{"enabled":true,"path":"/metrics"}}"#
                .to_string(),
        }];
        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.metrics_shutdown.is_some());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.metrics_shutdown.is_none());
    }
}
