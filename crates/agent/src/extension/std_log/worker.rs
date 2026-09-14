use super::config::StdLogConfig;
use super::format::{format_entry, get_severity};
use crate::logs::{GatewayLogEntry, LogSubscription};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// Implementations must return promptly; output backpressure must never block.
pub trait LogStreamWriter: Send + Sync + 'static {
    fn write_stdout(&self, line: &str);
    fn write_stderr(&self, line: &str);
}

#[derive(Clone, Copy, Default)]
pub struct DefaultStreamWriter;

impl LogStreamWriter for DefaultStreamWriter {
    fn write_stdout(&self, line: &str) {
        let _ = super::output::write_record(libc::STDOUT_FILENO, line.as_bytes());
    }

    fn write_stderr(&self, line: &str) {
        let _ = super::output::write_record(libc::STDERR_FILENO, line.as_bytes());
    }
}

pub struct StdLogWorkerHandle {
    cancel_token: CancellationToken,
    sender: mpsc::Sender<GatewayLogEntry>,
    task_a: Option<tokio::task::JoinHandle<()>>,
    task_b: Option<tokio::task::JoinHandle<()>>,
    writer_task: Option<tokio::task::JoinHandle<()>>,
}

impl StdLogWorkerHandle {
    pub fn cancel(&self) {
        self.cancel_token.cancel();
    }

    pub async fn shutdown(&mut self, timeout: Duration) {
        let start = std::time::Instant::now();

        // 1. Signal ingestion tasks to stop receiving new logs
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
        // writer_task receives all remaining records, gets None on EOF, flushes and exits cleanly.
        if let Some(mut h) = self.writer_task.take() {
            let remain = timeout.saturating_sub(start.elapsed());
            if tokio::time::timeout(remain, &mut h).await.is_err() {
                warn!(
                    "StdLogWorker flush timed out after {:?}; aborting background writer task",
                    timeout
                );
                h.abort();
                let _ = tokio::time::timeout(Duration::from_millis(100), h).await;
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
                .writer_task
                .as_ref()
                .map(|h| h.is_finished())
                .unwrap_or(true)
    }
}

impl Drop for StdLogWorkerHandle {
    fn drop(&mut self) {
        self.cancel_token.cancel();
        if let Some(h) = self.task_a.take() {
            h.abort();
        }
        if let Some(h) = self.task_b.take() {
            h.abort();
        }
        if let Some(h) = self.writer_task.take() {
            h.abort();
        }
    }
}

pub fn spawn_std_log_worker(
    config: StdLogConfig,
    subscription: Option<LogSubscription>,
) -> StdLogWorkerHandle {
    spawn_std_log_worker_inner(config, subscription, Arc::new(DefaultStreamWriter))
}

pub fn spawn_std_log_worker_inner<W: LogStreamWriter>(
    config: StdLogConfig,
    subscription: Option<LogSubscription>,
    writer: Arc<W>,
) -> StdLogWorkerHandle {
    let cancel_token = CancellationToken::new();
    let (tx, mut rx) = mpsc::channel::<GatewayLogEntry>(2048);

    // Channel bridging Ingestion -> Writer task
    let (event_tx, mut event_rx) = mpsc::channel::<GatewayLogEntry>(4096);

    // Task A: Channel ingestion task (for unit tests or synthetic events)
    let channel_cancel = cancel_token.clone();
    let sender_for_channel = event_tx.clone();
    let level_for_ch = config.log_level;

    let task_a = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = channel_cancel.cancelled() => {
                    while let Ok(entry) = rx.try_recv() {
                        if level_for_ch.allows(&entry) {
                            let _ = sender_for_channel.send(entry).await;
                        }
                    }
                    break;
                }
                entry_opt = rx.recv() => {
                    match entry_opt {
                        Some(entry) => {
                            if level_for_ch.allows(&entry) {
                                let _ = sender_for_channel.send(entry).await;
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
        let sender_for_subscription = event_tx.clone();
        let level_for_sub = config.log_level;

        Some(tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = sub_cancel.cancelled() => break,
                    res = sub.recv() => {
                        match res {
                            Ok(entry) => {
                                let entry_ref = entry.as_ref();
                                if level_for_sub.allows(entry_ref)
                                    && sender_for_subscription.send(entry_ref.clone()).await.is_err()
                                {
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

    // Drop our local sender clone so only task_a and task_b hold active sender references
    drop(event_tx);

    // Task C: Writer loop to bridge async formatting into stream_tx
    let writer_task = tokio::spawn(async move {
        while let Some(entry) = event_rx.recv().await {
            let line = format_entry(&entry, config.format, config.include_waf_details);
            let severity = get_severity(&entry);
            let is_stderr = config.split_streams && severity == "ERROR";
            if is_stderr {
                writer.write_stderr(&line);
            } else {
                writer.write_stdout(&line);
            }
        }
        info!("Standard stream logs background worker terminated cleanly");
    });

    StdLogWorkerHandle {
        cancel_token,
        sender: tx,
        task_a: Some(task_a),
        task_b,
        writer_task: Some(writer_task),
    }
}
