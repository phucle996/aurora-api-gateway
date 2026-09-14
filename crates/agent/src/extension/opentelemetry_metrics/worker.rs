use super::exporter::OtlpMetricsExporter;
use crate::metrics::MetricsCollector;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub fn spawn_otlp_metrics_worker(
    node_id: Arc<String>,
    exporter: Arc<OtlpMetricsExporter>,
    collector: Arc<MetricsCollector>,
) -> CancellationToken {
    let cancel_token = CancellationToken::new();
    let stop = cancel_token.clone();
    let interval = exporter.interval();

    tokio::spawn(async move {
        info!(interval = ?interval, "Starting OpenTelemetry metrics background exporter");
        let mut ticker = tokio::time::interval(interval);
        ticker.tick().await;

        loop {
            tokio::select! {
                _ = stop.cancelled() => {
                    info!("Shutting down OpenTelemetry metrics exporter");
                    break;
                }
                _ = ticker.tick() => {
                    let metrics = collector.collect().await;
                    if let Err(e) = exporter.export(&node_id, &metrics).await {
                        warn!(error = %e, "Failed to export OpenTelemetry metrics");
                    }
                }
            }
        }
    });

    cancel_token
}
