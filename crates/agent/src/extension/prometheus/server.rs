use crate::metrics::{MetricsCollector, format_prometheus};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

pub fn spawn_prometheus_server(
    port: u16,
    node_id: Arc<String>,
    collector: Arc<MetricsCollector>,
) -> CancellationToken {
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();

    tokio::spawn(async move {
        let addr = format!("0.0.0.0:{}", port);
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                info!("Prometheus metrics server listening on http://{}", addr);
                l
            }
            Err(e) => {
                error!(
                    "Failed to bind Prometheus metrics server on {}: {}",
                    addr, e
                );
                return;
            }
        };

        loop {
            tokio::select! {
                _ = stop.cancelled() => {
                    info!("Stopping Prometheus metrics HTTP server");
                    break;
                }
                accepted = listener.accept() => {
                    if let Ok((mut socket, _)) = accepted {
                        let node = node_id.clone();
                        let col = collector.clone();

                        tokio::spawn(async move {
                            let mut buf = [0u8; 1024];
                            if let Ok(n) = socket.read(&mut buf).await {
                                let req = String::from_utf8_lossy(&buf[..n]);

                                if req.starts_with("GET /metrics") || req.starts_with("GET /metrics/prometheus") {
                                    let metrics = col.collect().await;
                                    let body = format_prometheus(&node, &metrics);
                                    let resp = format!(
                                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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

    shutdown
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    #[tokio::test]
    async fn test_prometheus_server_scrape_and_shutdown() {
        let port = 19188;
        let node_id = Arc::new("test-node-prom".to_string());
        let collector = Arc::new(MetricsCollector::new());

        let shutdown = spawn_prometheus_server(port, node_id, collector);
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Scrape /metrics
        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port))
            .await
            .expect("connect to prometheus");
        stream
            .write_all(b"GET /metrics HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();

        let mut resp = String::new();
        stream.read_to_string(&mut resp).await.unwrap();
        assert!(resp.starts_with("HTTP/1.1 200 OK"));
        assert!(resp.contains("Content-Type: text/plain; version=0.0.4; charset=utf-8"));
        assert!(resp.contains("node_id=\"test-node-prom\""));

        // Health check
        let mut stream_health = TcpStream::connect(format!("127.0.0.1:{}", port))
            .await
            .expect("connect to prometheus health");
        stream_health
            .write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        let mut resp_health = String::new();
        stream_health
            .read_to_string(&mut resp_health)
            .await
            .unwrap();
        assert!(resp_health.contains("HTTP/1.1 200 OK"));
        assert!(resp_health.ends_with("ok"));

        // Cancel shutdown
        shutdown.cancel();
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Connection should fail after shutdown
        assert!(
            TcpStream::connect(format!("127.0.0.1:{}", port))
                .await
                .is_err()
        );
    }
}
