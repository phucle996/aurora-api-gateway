use super::exporter::OtlpLogsExporter;
use crate::logs::{GatewayLogEntry, LogSubscription};
use opentelemetry_proto::tonic::logs::v1::{LogRecord, SeverityNumber};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub struct OtlpLogsWorkerHandle {
    cancel_token: CancellationToken,
    sender: mpsc::Sender<GatewayLogEntry>,
    task_a: Option<tokio::task::JoinHandle<()>>,
    task_b: Option<tokio::task::JoinHandle<()>>,
    flush_task: Option<tokio::task::JoinHandle<()>>,
}

impl OtlpLogsWorkerHandle {
    pub fn cancel(&self) {
        self.cancel_token.cancel();
    }

    pub async fn shutdown(&mut self, timeout: Duration) {
        let start = std::time::Instant::now();

        // 1. Signal ingestion tasks to stop accepting new records
        self.cancel_token.cancel();

        // 2. Wait for ingestion task A and task B to complete and drop their senders
        if let Some(mut h) = self.task_a.take() {
            let remain = timeout.saturating_sub(start.elapsed());
            if tokio::time::timeout(remain.min(Duration::from_millis(500)), &mut h)
                .await
                .is_err()
            {
                h.abort();
                let _ = h.await;
            }
        }
        if let Some(mut h) = self.task_b.take() {
            let remain = timeout.saturating_sub(start.elapsed());
            if tokio::time::timeout(remain.min(Duration::from_millis(500)), &mut h)
                .await
                .is_err()
            {
                h.abort();
                let _ = h.await;
            }
        }

        // 3. All senders to event_rx are now dropped.
        // Task C (flush_task) receives all remaining records, gets None on EOF, flushes buffer, and exits.
        if let Some(mut h) = self.flush_task.take() {
            let remain = timeout.saturating_sub(start.elapsed());
            if tokio::time::timeout(remain, &mut h).await.is_err() {
                warn!(
                    "OtlpLogsWorker flush timed out after {:?}; aborting background flush task",
                    timeout
                );
                h.abort();
                let _ = h.await;
            }
        }
    }

    pub fn sender(&self) -> mpsc::Sender<GatewayLogEntry> {
        self.sender.clone()
    }

    pub fn is_terminated(&self) -> bool {
        self.task_a
            .as_ref()
            .map(|h| h.is_finished())
            .unwrap_or(true)
            && self
                .task_b
                .as_ref()
                .map(|h| h.is_finished())
                .unwrap_or(true)
            && self
                .flush_task
                .as_ref()
                .map(|h| h.is_finished())
                .unwrap_or(true)
    }
}

impl Drop for OtlpLogsWorkerHandle {
    fn drop(&mut self) {
        self.cancel_token.cancel();
        if let Some(h) = self.task_a.take() {
            h.abort();
        }
        if let Some(h) = self.task_b.take() {
            h.abort();
        }
        if let Some(h) = self.flush_task.take() {
            h.abort();
        }
    }
}

pub fn spawn_otlp_logs_worker(
    node_id: String,
    exporter: OtlpLogsExporter,
    subscription: Option<LogSubscription>,
) -> OtlpLogsWorkerHandle {
    let cancel_token = CancellationToken::new();
    let (tx, mut rx) = mpsc::channel::<GatewayLogEntry>(2048);

    let worker_exporter = exporter.clone();
    let worker_node_id = node_id.clone();

    // 1. Channel bridging Ingestion -> Flush task
    let (event_tx, mut event_rx) = mpsc::channel::<LogRecord>(4096);

    // Task A: Channel ingestion task (for testing or synthetic events)
    let channel_cancel = cancel_token.clone();
    let service_name_for_ch = worker_exporter.service_name().to_string();
    let level_for_ch = worker_exporter.log_level();
    let sender_for_channel = event_tx.clone();

    let task_a = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = channel_cancel.cancelled() => {
                    // Drain remaining queued entries from channel before exiting
                    while let Ok(entry) = rx.try_recv() {
                        let record = entry.into_log_record(&service_name_for_ch);
                        let sev = match record.severity_number {
                            9..=12 => SeverityNumber::Info,
                            13..=16 => SeverityNumber::Warn,
                            17..=20 => SeverityNumber::Error,
                            _ => SeverityNumber::Info,
                        };
                        if level_for_ch.allows(sev) {
                            let _ = sender_for_channel.send(record).await;
                        }
                    }
                    break;
                }
                entry_opt = rx.recv() => {
                    match entry_opt {
                        Some(entry) => {
                            let record = entry.into_log_record(&service_name_for_ch);
                            let sev = match record.severity_number {
                                9..=12 => SeverityNumber::Info,
                                13..=16 => SeverityNumber::Warn,
                                17..=20 => SeverityNumber::Error,
                                _ => SeverityNumber::Info,
                            };
                            if level_for_ch.allows(sev) {
                                let _ = sender_for_channel.send(record).await;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    // Task B: Subscription ingestion task from zero-disk LogBus
    let task_b = if let Some(mut sub) = subscription {
        let sub_cancel = cancel_token.clone();
        let service_name_for_sub = exporter.service_name().to_string();
        let level_for_sub = exporter.log_level();
        let sender_for_subscription = event_tx.clone();

        Some(tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sub_cancel.cancelled() => break,
                    res = sub.recv() => {
                        match res {
                            Ok(entry) => {
                                let record = entry.as_ref().clone().into_log_record(&service_name_for_sub);
                                let sev = match record.severity_number {
                                    9..=12 => SeverityNumber::Info,
                                    13..=16 => SeverityNumber::Warn,
                                    17..=20 => SeverityNumber::Error,
                                    _ => SeverityNumber::Info,
                                };
                                if level_for_sub.allows(sev) && sender_for_subscription.send(record).await.is_err() {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        }))
    } else {
        None
    };

    // Drop our local sender clone so only task_a and task_b hold sender references
    drop(event_tx);

    // Task C: Buffer batching & OTLP flush loop
    let flush_task = tokio::spawn(async move {
        let mut buffer = Vec::with_capacity(worker_exporter.batch_size());
        let mut interval = tokio::time::interval(worker_exporter.flush_interval());

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if !buffer.is_empty() {
                        let records = std::mem::take(&mut buffer);
                        if let Err(e) = worker_exporter.export_batch(&worker_node_id, records).await {
                            warn!("Failed to export OTLP logs batch: {e}");
                        }
                    }
                }
                record_opt = event_rx.recv() => {
                    match record_opt {
                        Some(record) => {
                            buffer.push(record);
                            if buffer.len() >= worker_exporter.batch_size() {
                                let records = std::mem::take(&mut buffer);
                                if let Err(e) = worker_exporter.export_batch(&worker_node_id, records).await {
                                    warn!("Failed to export full OTLP logs batch: {e}");
                                }
                            }
                        }
                        None => {
                            // All ingestion tasks exited, all senders dropped, and event_rx fully drained!
                            if !buffer.is_empty() {
                                let records = std::mem::take(&mut buffer);
                                if let Err(e) = worker_exporter.export_batch(&worker_node_id, records).await {
                                    warn!("Failed to export final OTLP logs batch: {e}");
                                }
                            }
                            info!("OpenTelemetry logs background worker terminated cleanly");
                            break;
                        }
                    }
                }
            }
        }
    });

    OtlpLogsWorkerHandle {
        cancel_token,
        sender: tx,
        task_a: Some(task_a),
        task_b,
        flush_task: Some(flush_task),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_log_entry_to_log_record() {
        let entry = GatewayLogEntry {
            client_ip: Some("192.168.1.50".to_string()),
            method: Some("GET".to_string()),
            uri: Some("/api/users".to_string()),
            status: Some(200),
            duration_ms: Some(12.5),
            request_time: None,
            bytes_sent: Some(1024),
            user_agent: Some("curl/7.68.0".to_string()),
            host: Some("gateway.local".to_string()),
            waf_action: Some("allow".to_string()),
            waf_rule_id: None,
            message: None,
            level: None,
            timestamp_unix_nano: Some(1700000000000000000),
            ..Default::default()
        };

        let record = entry.into_log_record("aurora-gateway");
        assert_eq!(record.severity_number, SeverityNumber::Info as i32);
        assert_eq!(record.severity_text, "INFO");
        assert_eq!(record.time_unix_nano, 1700000000000000000);

        assert!(
            record
                .attributes
                .iter()
                .any(|kv| kv.key == "http.request.method")
        );
        assert!(record.attributes.iter().any(|kv| kv.key == "url.path"));
        assert!(
            record
                .attributes
                .iter()
                .any(|kv| kv.key == "http.response.status_code")
        );

        let waf_blocked = GatewayLogEntry {
            client_ip: Some("10.0.0.1".to_string()),
            method: Some("POST".to_string()),
            uri: Some("/login".to_string()),
            status: Some(403),
            duration_ms: Some(1.2),
            request_time: None,
            bytes_sent: Some(150),
            user_agent: Some("sqlmap".to_string()),
            host: Some("gateway.local".to_string()),
            waf_action: Some("block".to_string()),
            waf_rule_id: Some("sqli-rule-1".to_string()),
            message: None,
            level: None,
            timestamp_unix_nano: None,
            ..Default::default()
        };

        let blocked_rec = waf_blocked.into_log_record("aurora-gateway");
        assert_eq!(blocked_rec.severity_number, SeverityNumber::Error as i32);
        assert_eq!(blocked_rec.severity_text, "ERROR");
    }

    #[tokio::test]
    async fn test_worker_shutdown_drains_remaining_queue() {
        use super::super::config::OtlpLogsConfig;
        use prost::Message;
        use std::sync::Arc;
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // 1. Mock local OTLP HTTP receiver
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let received_count = Arc::new(AtomicUsize::new(0));
        let rc = received_count.clone();

        let server_handle = tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = vec![0u8; 16384];
                let mut n_total = 0;
                while let Ok(n) = stream.read(&mut buf[n_total..]).await {
                    if n == 0 {
                        break;
                    }
                    n_total += n;
                    if let Some(pos) = buf[..n_total].windows(4).position(|w| w == b"\r\n\r\n") {
                        let header_str = String::from_utf8_lossy(&buf[..pos]);
                        let content_len: usize = header_str
                            .lines()
                            .find(|l| l.to_lowercase().starts_with("content-length:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|s| s.trim().parse().ok())
                            .unwrap_or(0);
                        let body_start = pos + 4;
                        if n_total >= body_start + content_len {
                            let body = &buf[body_start..body_start + content_len];
                            if let Ok(req) =
                                opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest::decode(
                                    body,
                                )
                            {
                                let records_in_req: usize = req
                                    .resource_logs
                                    .iter()
                                    .flat_map(|rl| &rl.scope_logs)
                                    .map(|sl| sl.log_records.len())
                                    .sum();
                                rc.fetch_add(records_in_req, Ordering::SeqCst);
                            }
                            let _ = stream
                                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                                .await;
                            break;
                        }
                    }
                }
            }
        });

        let exporter = OtlpLogsExporter::new(OtlpLogsConfig {
            enabled: true,
            endpoint: format!("http://127.0.0.1:{}", port),
            protocol: "http".to_string(),
            batch_size: 10,
            flush_interval_ms: 10000,
            timeout_ms: 500,
            service_name: "test-drain".to_string(),
            log_level: "all".to_string(),
        })
        .unwrap();

        let mut handle = spawn_otlp_logs_worker("test-node".to_string(), exporter, None);
        let sender = handle.sender();

        for i in 0..5 {
            let _ = sender
                .send(GatewayLogEntry {
                    status: Some(200),
                    uri: Some(format!("/test-{}", i)),
                    ..Default::default()
                })
                .await;
        }

        // Calling shutdown should drain the queued items and terminate within timeout
        let start = std::time::Instant::now();
        handle.shutdown(std::time::Duration::from_secs(2)).await;
        let _ = server_handle.await;

        assert!(start.elapsed() < std::time::Duration::from_secs(3));
        assert_eq!(received_count.load(Ordering::SeqCst), 5);
        assert!(handle.is_terminated());
    }

    #[tokio::test]
    async fn test_worker_shutdown_aborts_on_timeout() {
        use super::super::config::OtlpLogsConfig;

        // Point to non-routable TEST-NET-1 IP where connect will hang
        let exporter = OtlpLogsExporter::new(OtlpLogsConfig {
            enabled: true,
            endpoint: "http://192.0.2.1:4318".to_string(),
            protocol: "http".to_string(),
            batch_size: 1,
            flush_interval_ms: 10000,
            timeout_ms: 5000,
            service_name: "test-abort".to_string(),
            log_level: "all".to_string(),
        })
        .unwrap();

        let mut handle = spawn_otlp_logs_worker("test-node".to_string(), exporter, None);
        let sender = handle.sender();
        let _ = sender
            .send(GatewayLogEntry {
                status: Some(200),
                uri: Some("/hang".to_string()),
                ..Default::default()
            })
            .await;

        // Shutdown with very short timeout (50ms) to force abort
        let start = std::time::Instant::now();
        handle.shutdown(std::time::Duration::from_millis(50)).await;
        assert!(start.elapsed() < std::time::Duration::from_millis(1500));
        assert!(handle.is_terminated());
    }
}
