pub mod collector;
pub mod pull;
pub mod push;

#[allow(unused_imports)]
pub use collector::{format_prometheus, parse_stub_status, MetricsCollector, NodeMetrics};
pub use pull::{PrometheusExporter, PullExporter};
pub use push::{OtlpExporter, PushExporter};

use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

pub const DEFAULT_STUB_STATUS_URL: &str = "http://127.0.0.1:80/stub_status";

pub struct MetricsManager {
    collector: Arc<MetricsCollector>,
    stub_status_url: String,
    pull_exporters: Vec<Arc<dyn PullExporter>>,
    push_exporters: Vec<Arc<dyn PushExporter>>,
}

impl Default for MetricsManager {
    fn default() -> Self {
        Self::new(DEFAULT_STUB_STATUS_URL)
    }
}

impl MetricsManager {
    pub fn new(stub_status_url: impl Into<String>) -> Self {
        Self {
            collector: Arc::new(MetricsCollector::new()),
            stub_status_url: stub_status_url.into(),
            pull_exporters: Vec::new(),
            push_exporters: Vec::new(),
        }
    }

    pub fn with_stub_status_url(mut self, url: impl Into<String>) -> Self {
        self.stub_status_url = url.into();
        self
    }

    pub fn with_pull_exporter(mut self, exporter: Arc<dyn PullExporter>) -> Self {
        self.pull_exporters.push(exporter);
        self
    }

    pub fn with_push_exporter(mut self, exporter: Arc<dyn PushExporter>) -> Self {
        self.push_exporters.push(exporter);
        self
    }

    /// Run the metrics subsystem. Strictly enforces ZERO-OVERHEAD when no exporters are active.
    pub async fn run(self, port: u16, node_id: Arc<String>, shutdown: CancellationToken) {
        let active_pulls: Vec<Arc<dyn PullExporter>> = self
            .pull_exporters
            .into_iter()
            .filter(|e| e.is_enabled())
            .collect();

        let active_pushes: Vec<Arc<dyn PushExporter>> = self
            .push_exporters
            .into_iter()
            .filter(|e| e.is_enabled())
            .collect();

        if active_pulls.is_empty() && active_pushes.is_empty() {
            info!("No metrics exporters enabled; zero collection overhead active");
            return;
        }

        let stub_url = Arc::new(self.stub_status_url);

        // 1. Launch Push Exporters (periodic background export loops)
        for push in active_pushes {
            let col = self.collector.clone();
            let node = node_id.clone();
            let stop = shutdown.clone();
            let s_url = stub_url.clone();

            tokio::spawn(async move {
                info!(name = %push.name(), interval = ?push.interval(), "Starting metrics push exporter loop");
                let mut ticker = tokio::time::interval(push.interval());
                // Skip the first immediate tick to allow service warmup
                ticker.tick().await;

                loop {
                    tokio::select! {
                        _ = stop.cancelled() => {
                            info!(name = %push.name(), "Shutting down metrics push exporter");
                            break;
                        }
                        _ = ticker.tick() => {
                            let metrics = col.collect(&s_url).await;
                            if let Err(e) = push.export(&node, &metrics).await {
                                tracing::warn!(name = %push.name(), error = %e, "Failed to push metrics sample");
                            }
                        }
                    }
                }
            });
        }

        // 2. Launch Pull Exporters (HTTP listener for on-demand scrape)
        if !active_pulls.is_empty() {
            let addr = format!("0.0.0.0:{}", port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    info!("Agent metrics server listening on http://{}", addr);
                    l
                }
                Err(e) => {
                    error!("Failed to bind metrics server on {}: {}", addr, e);
                    return;
                }
            };

            let collector = self.collector.clone();
            let pulls = Arc::new(active_pulls);
            let s_url = stub_url.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = shutdown.cancelled() => {
                            info!("Stopping metrics HTTP server");
                            break;
                        }
                        accepted = listener.accept() => {
                            if let Ok((mut socket, _)) = accepted {
                                let node = node_id.clone();
                                let col = collector.clone();
                                let registered_pulls = pulls.clone();
                                let url_target = s_url.clone();

                                tokio::spawn(async move {
                                    let mut buf = [0u8; 1024];
                                    if let Ok(n) = socket.read(&mut buf).await {
                                        let req = String::from_utf8_lossy(&buf[..n]);
                                        
                                        // Match request against registered pull exporters
                                        let mut matched_exporter = None;
                                        for p in registered_pulls.iter() {
                                            let path_prefix = format!("GET {}", p.endpoint_path());
                                            if req.starts_with(&path_prefix) {
                                                matched_exporter = Some(p.clone());
                                                break;
                                            }
                                        }

                                        // Fallback alias: /metrics maps to prometheus if enabled
                                        if matched_exporter.is_none() && (req.starts_with("GET /metrics ") || req.starts_with("GET /metrics?")) {
                                            for p in registered_pulls.iter() {
                                                if p.name() == "prometheus" {
                                                    matched_exporter = Some(p.clone());
                                                    break;
                                                }
                                            }
                                        }

                                        if let Some(exp) = matched_exporter {
                                            // Pure on-demand collection: Executed ONLY when scraped
                                            let metrics = col.collect(&url_target).await;
                                            let (body, content_type) = exp.render(&node, &metrics);
                                            let resp = format!(
                                                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                                content_type,
                                                body.len(),
                                                body
                                            );
                                            let _ = socket.write_all(resp.as_bytes()).await;
                                        } else if req.starts_with("GET /healthz") {
                                            let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
                                            let _ = socket.write_all(resp.as_bytes()).await;
                                        } else {
                                            let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                                            let _ = socket.write_all(resp.as_bytes()).await;
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_manager_builder() {
        let mgr = MetricsManager::default();
        assert_eq!(mgr.stub_status_url, DEFAULT_STUB_STATUS_URL);

        let custom = MetricsManager::new("http://127.0.0.1:8080/stub")
            .with_stub_status_url("http://127.0.0.1:9090/stub_status");
        assert_eq!(custom.stub_status_url, "http://127.0.0.1:9090/stub_status");
    }
}
