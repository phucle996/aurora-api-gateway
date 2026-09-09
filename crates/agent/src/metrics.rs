use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{error, info};

pub async fn run_metrics_server(port: u16, node_id: Arc<String>) {
    let addr = format!("0.0.0.0:{}", port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => {
            info!("Agent metrics & health server listening on http://{}", addr);
            l
        }
        Err(e) => {
            error!("Failed to bind metrics server on {}: {}", addr, e);
            return;
        }
    };

    loop {
        if let Ok((mut socket, _)) = listener.accept().await {
            let node = node_id.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                if let Ok(n) = socket.read(&mut buf).await {
                    let req = String::from_utf8_lossy(&buf[..n]);
                    if req.starts_with("GET /metrics") {
                        let body = format!(
                            "# HELP aurora_node_info Node metadata\n\
                             # TYPE aurora_node_info gauge\n\
                             aurora_node_info{{node_id=\"{}\",version=\"{}\",status=\"healthy\"}} 1\n",
                            node,
                            env!("CARGO_PKG_VERSION")
                        );
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
