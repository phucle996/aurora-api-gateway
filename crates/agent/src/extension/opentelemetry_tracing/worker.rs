use super::config::Sampler;
use super::exporter::OtlpTracingExporter;
use crate::logs::{GatewayLogEntry, LogSubscription};
use opentelemetry_proto::tonic::common::v1::{
    AnyValue, KeyValue, any_value::Value as AnyValueUnion,
};
use opentelemetry_proto::tonic::trace::v1::{Span, Status, span::SpanKind, status::StatusCode};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub struct OtlpTracingWorkerHandle {
    cancel_token: CancellationToken,
    sender: mpsc::Sender<GatewayLogEntry>,
    task_a: Option<tokio::task::JoinHandle<()>>,
    task_b: Option<tokio::task::JoinHandle<()>>,
    flush_task: Option<tokio::task::JoinHandle<()>>,
}

impl OtlpTracingWorkerHandle {
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
        // Task C (flush_task) receives all remaining spans, gets None on EOF, flushes buffer, and exits.
        if let Some(mut h) = self.flush_task.take() {
            let remain = timeout.saturating_sub(start.elapsed());
            if tokio::time::timeout(remain, &mut h).await.is_err() {
                warn!(
                    "OtlpTracingWorker flush timed out after {:?}; aborting background flush task",
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

impl Drop for OtlpTracingWorkerHandle {
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

fn random_id<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    let res = unsafe { libc::getentropy(buf.as_mut_ptr() as *mut libc::c_void, N) };
    if res != 0 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(42);
        let mut state = nanos as u64 ^ 0x517cc1b727220a95;
        for byte in buf.iter_mut() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *byte = (state & 0xFF) as u8;
        }
    }
    if buf.iter().all(|&b| b == 0) {
        buf[0] = 1;
    }
    buf
}

pub fn entry_to_span(entry: &GatewayLogEntry) -> Option<Span> {
    let trace_id_str = entry.trace_id.as_deref()?;
    if trace_id_str.is_empty() {
        return None;
    }
    let trace_id_bytes = hex::decode(trace_id_str).ok()?;
    if trace_id_bytes.len() != 16 {
        return None;
    }

    let now_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);

    let end_time_unix_nano = entry.timestamp_unix_nano.unwrap_or(now_nanos);
    let duration_nanos = (entry.effective_duration_ms().unwrap_or(0.0) * 1_000_000.0) as u64;
    let start_time_unix_nano = end_time_unix_nano.saturating_sub(duration_nanos);

    let status_code = entry.status.unwrap_or(200);
    let is_waf_blocked = entry
        .waf_action
        .as_deref()
        .map(|a| a.eq_ignore_ascii_case("block"))
        .unwrap_or(false);

    let span_status = if status_code >= 500 || is_waf_blocked {
        Status {
            message: if is_waf_blocked {
                "request blocked by WAF security policy".to_string()
            } else {
                format!("HTTP error {status_code}")
            },
            code: StatusCode::Error as i32,
        }
    } else {
        Status {
            message: String::new(),
            code: StatusCode::Ok as i32,
        }
    };

    let make_str_attr = |k: &str, v: String| KeyValue {
        key: k.to_string(),
        value: Some(AnyValue {
            value: Some(AnyValueUnion::StringValue(v)),
        }),
        ..Default::default()
    };
    let make_int_attr = |k: &str, v: i64| KeyValue {
        key: k.to_string(),
        value: Some(AnyValue {
            value: Some(AnyValueUnion::IntValue(v)),
        }),
        ..Default::default()
    };

    let mut attributes = Vec::with_capacity(8);

    if let Some(ref method) = entry.method {
        attributes.push(make_str_attr("http.method", method.clone()));
    }

    if let Some(ref uri) = entry.uri {
        attributes.push(make_str_attr("http.target", uri.clone()));
    }

    attributes.push(make_int_attr("http.status_code", status_code as i64));

    if let Some(ref host) = entry.host {
        attributes.push(make_str_attr("http.host", host.clone()));
    }

    if let Some(ref ip) = entry.client_ip {
        attributes.push(make_str_attr("http.client_ip", ip.clone()));
    }

    if let Some(ref ua) = entry.user_agent {
        attributes.push(make_str_attr("http.user_agent", ua.clone()));
    }

    if let Some(ref action) = entry.waf_action {
        attributes.push(make_str_attr("waf.action", action.clone()));
    }

    if let Some(ref rule_id) = entry.waf_rule_id {
        attributes.push(make_str_attr("waf.rule_id", rule_id.clone()));
    }

    let span_id = random_id::<8>();
    let method_str = entry.method.as_deref().unwrap_or("HTTP");
    let name = format!("{method_str} {}", entry.uri.as_deref().unwrap_or("/"));

    Some(Span {
        trace_id: trace_id_bytes,
        span_id: span_id.to_vec(),
        trace_state: String::new(),
        parent_span_id: Vec::new(),
        flags: 1, // SAMPLED flag
        name,
        kind: SpanKind::Server as i32,
        start_time_unix_nano,
        end_time_unix_nano,
        attributes,
        dropped_attributes_count: 0,
        events: Vec::new(),
        dropped_events_count: 0,
        links: Vec::new(),
        dropped_links_count: 0,
        status: Some(span_status),
    })
}

pub fn spawn_otlp_tracing_worker(
    node_id: String,
    exporter: OtlpTracingExporter,
    subscription: Option<LogSubscription>,
) -> OtlpTracingWorkerHandle {
    let cancel_token = CancellationToken::new();
    let (tx, mut rx) = mpsc::channel::<GatewayLogEntry>(2048);

    let worker_exporter = exporter.clone();
    let worker_node_id = node_id.clone();
    let sampler = Sampler::new(exporter.sample_rate());

    // Channel bridging Ingestion -> Flush task (bounded memory buffer for non-blocking backpressure)
    let buffer_cap = (worker_exporter.batch_size() * 4).max(1024);
    let (event_tx, mut event_rx) = mpsc::channel::<Span>(buffer_cap);

    // Task A: Channel ingestion task
    let channel_cancel = cancel_token.clone();
    let sender_for_channel = event_tx.clone();

    let task_a = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = channel_cancel.cancelled() => {
                    while let Ok(entry) = rx.try_recv() {
                        if let Some(span) = entry_to_span(&entry)
                            && let Ok(trace_id_arr) = <[u8; 16]>::try_from(span.trace_id.as_slice())
                            && sampler.should_sample(&trace_id_arr)
                        {
                            let _ = sender_for_channel.send(span).await;
                        }
                    }
                    break;
                }
                entry_opt = rx.recv() => {
                    match entry_opt {
                        Some(entry) => {
                            if let Some(span) = entry_to_span(&entry)
                                && let Ok(trace_id_arr) = <[u8; 16]>::try_from(span.trace_id.as_slice())
                                && sampler.should_sample(&trace_id_arr)
                            {
                                let _ = sender_for_channel.send(span).await;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    // Task B: Subscription ingestion task from zero-disk LogBus (Non-blocking with try_send backpressure)
    let task_b = if let Some(mut sub) = subscription {
        let sub_cancel = cancel_token.clone();
        let sender_for_subscription = event_tx.clone();

        Some(tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sub_cancel.cancelled() => break,
                    res = sub.recv() => {
                        match res {
                            Ok(entry) => {
                                if let Some(span) = entry_to_span(entry.as_ref())
                                    && let Ok(trace_id_arr) = <[u8; 16]>::try_from(span.trace_id.as_slice())
                                    && sampler.should_sample(&trace_id_arr)
                                {
                                    // Non-blocking try_send: if buffer is full, drop span without blocking log bus
                                    if let Err(mpsc::error::TrySendError::Full(_)) = sender_for_subscription.try_send(span) {
                                        warn!("OtlpTracingWorker span buffer full; dropping span under load to preserve gateway latency");
                                    }
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                warn!("OtlpTracingWorker lagged on log bus; skipped {skipped} messages");
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                break;
                            }
                        }
                    }
                }
            }
        }))
    } else {
        None
    };

    // Task C: Buffer batching & OTLP flush loop
    let flush_task = tokio::spawn(async move {
        let mut buffer = Vec::with_capacity(worker_exporter.batch_size());
        let mut interval = tokio::time::interval(worker_exporter.flush_interval());

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if !buffer.is_empty() {
                        let spans = std::mem::take(&mut buffer);
                        if let Err(e) = worker_exporter.export_batch(&worker_node_id, spans).await {
                            warn!("Failed to export OTLP traces batch: {e}");
                        }
                    }
                }
                span_opt = event_rx.recv() => {
                    match span_opt {
                        Some(span) => {
                            buffer.push(span);
                            if buffer.len() >= worker_exporter.batch_size() {
                                let spans = std::mem::take(&mut buffer);
                                if let Err(e) = worker_exporter.export_batch(&worker_node_id, spans).await {
                                    warn!("Failed to export full OTLP traces batch: {e}");
                                }
                            }
                        }
                        None => {
                            // Ingestion tasks finished, drain remaining buffer
                            if !buffer.is_empty() {
                                let spans = std::mem::take(&mut buffer);
                                if let Err(e) = worker_exporter.export_batch(&worker_node_id, spans).await {
                                    warn!("Failed to export final OTLP traces batch: {e}");
                                }
                            }
                            info!("OpenTelemetry tracing background worker terminated cleanly");
                            break;
                        }
                    }
                }
            }
        }
    });

    OtlpTracingWorkerHandle {
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
    use crate::extension::opentelemetry_tracing::config::OtlpTracingConfig;

    #[test]
    fn test_entry_to_span_conversion() {
        let entry = GatewayLogEntry {
            client_ip: Some("10.0.0.1".to_string()),
            method: Some("GET".to_string()),
            uri: Some("/api/v1/orders".to_string()),
            status: Some(200),
            duration_ms: Some(45.5),
            bytes_sent: Some(1024),
            user_agent: Some("curl/7.81.0".to_string()),
            host: Some("example.com".to_string()),
            waf_action: Some("allow".to_string()),
            waf_rule_id: None,
            timestamp_unix_nano: Some(1_700_000_000_000_000_000),
            trace_id: Some("0123456789abcdef0123456789abcdef".to_string()),
            ..Default::default()
        };

        let span = entry_to_span(&entry).expect("span should be created when trace_id present");
        assert_eq!(span.trace_id.len(), 16);
        assert_eq!(span.span_id.len(), 8);
        assert_eq!(span.name, "GET /api/v1/orders");
        assert_eq!(span.kind, SpanKind::Server as i32);
        assert_eq!(span.end_time_unix_nano, 1_700_000_000_000_000_000);
        assert_eq!(
            span.start_time_unix_nano,
            1_700_000_000_000_000_000 - 45_500_000
        );

        let status = span.status.unwrap();
        assert_eq!(status.code, StatusCode::Ok as i32);

        let has_ip = span.attributes.iter().any(|kv| {
            kv.key == "http.client_ip"
                && match &kv.value.as_ref().unwrap().value {
                    Some(AnyValueUnion::StringValue(v)) => v == "10.0.0.1",
                    _ => false,
                }
        });
        assert!(has_ip);
    }

    #[test]
    fn test_entry_to_span_none_when_no_trace_id() {
        let entry_no_trace = GatewayLogEntry {
            client_ip: Some("10.0.0.1".to_string()),
            method: Some("GET".to_string()),
            uri: Some("/test".to_string()),
            status: Some(200),
            trace_id: None,
            ..Default::default()
        };
        assert!(entry_to_span(&entry_no_trace).is_none());

        let entry_empty_trace = GatewayLogEntry {
            trace_id: Some("".to_string()),
            ..Default::default()
        };
        assert!(entry_to_span(&entry_empty_trace).is_none());

        let entry_invalid_hex = GatewayLogEntry {
            trace_id: Some("not-hex-at-all".to_string()),
            ..Default::default()
        };
        assert!(entry_to_span(&entry_invalid_hex).is_none());
    }

    #[test]
    fn test_entry_to_span_waf_block_marked_error() {
        let entry = GatewayLogEntry {
            client_ip: Some("1.2.3.4".to_string()),
            method: Some("POST".to_string()),
            uri: Some("/admin/login".to_string()),
            status: Some(403),
            waf_action: Some("block".to_string()),
            waf_rule_id: Some("942100".to_string()),
            trace_id: Some("0123456789abcdef0123456789abcdef".to_string()),
            ..Default::default()
        };

        let span = entry_to_span(&entry).expect("span should be created when trace_id present");
        let status = span.status.unwrap();
        assert_eq!(status.code, StatusCode::Error as i32);
        assert!(status.message.contains("WAF"));
    }

    #[tokio::test]
    async fn test_worker_shutdown_drains_remaining_spans() {
        let cfg = OtlpTracingConfig {
            enabled: true,
            endpoint: "http://127.0.0.1:4318".to_string(),
            protocol: "http".to_string(),
            sample_rate: 1.0,
            batch_size: 100,
            flush_interval_ms: 10000,
            timeout_ms: 3000,
            service_name: "test-svc".to_string(),
        };

        let exporter = OtlpTracingExporter::new(cfg).unwrap();
        let mut handle = spawn_otlp_tracing_worker("test-node".to_string(), exporter, None);

        let sender = handle.sender();
        for i in 0..10 {
            let entry = GatewayLogEntry {
                client_ip: Some(format!("10.0.0.{i}")),
                method: Some("GET".to_string()),
                uri: Some(format!("/test/{i}")),
                status: Some(200),
                trace_id: Some(format!("{i:032x}")),
                ..Default::default()
            };
            sender.send(entry).await.unwrap();
        }

        handle.shutdown(Duration::from_millis(500)).await;
        assert!(handle.is_terminated());
    }
}
