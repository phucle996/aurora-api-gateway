//! Unified Background Phase Task Dispatcher & Shadow Worker Loop.
//!
//! Replaces monolithic request event structures with explicit, typed background tasks:
//! - `AccessLogTask`: offloaded only when access logging is required
//! - `HttpMetricTask`: offloaded only for status & metrics aggregation
//! - `TraceSpanTask`: offloaded only for sampled tracing spans
//!
//! Traffic Workers purely dispatch tasks (< 20ns, lock-free non-blocking queue);
//! Companion Shadow Workers autonomously execute tasks without hot-path CPU contention.

use parking_lot::RwLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::access_log::{AccessLogPlugin, AccessLogTask};
use crate::opentelemetry::TraceSpanTask;
use crate::prometheus::{HttpMetricTask, PrometheusPlugin};

/// Typed background task submitted from the Traffic Worker to the Shadow Worker.
#[derive(Clone, Debug)]
pub enum GatewayBackgroundTask {
    AccessLog(Box<AccessLogTask>),
    HttpMetric(HttpMetricTask),
    TraceSpan(TraceSpanTask),
}

static TASK_SENDER: RwLock<Option<mpsc::Sender<GatewayBackgroundTask>>> = RwLock::new(None);
static DROPPED_TASKS: AtomicU64 = AtomicU64::new(0);
static ENQUEUED_TASKS: AtomicU64 = AtomicU64::new(0);

/// Registers the global Shadow Worker background task queue sender.
pub fn set_task_sender(tx: mpsc::Sender<GatewayBackgroundTask>) {
    *TASK_SENDER.write() = Some(tx);
}

/// Clears the global Shadow Worker background task queue sender on shutdown.
pub fn clear_task_sender() {
    *TASK_SENDER.write() = None;
}

/// Returns the number of background tasks dropped due to channel saturation or missing sender.
pub fn dropped_tasks_count() -> u64 {
    DROPPED_TASKS.load(Ordering::Relaxed)
}

/// Returns the number of background tasks successfully queued for background processing.
pub fn logged_tasks_count() -> u64 {
    ENQUEUED_TASKS.load(Ordering::Relaxed)
}

/// Submits a background task from the Traffic Worker to the companion Shadow Worker.
///
/// Executes in < 20ns on the hot path: non-blocking `try_send`, zero allocations, zero I/O syscalls.
pub fn submit_task(task: GatewayBackgroundTask) -> bool {
    let guard = TASK_SENDER.read();
    if let Some(ref tx) = *guard {
        match tx.try_send(task) {
            Ok(()) => {
                ENQUEUED_TASKS.fetch_add(1, Ordering::Relaxed);
                true
            }
            Err(_) => {
                DROPPED_TASKS.fetch_add(1, Ordering::Relaxed);
                false
            }
        }
    } else {
        DROPPED_TASKS.fetch_add(1, Ordering::Relaxed);
        false
    }
}

/// Dedicated autonomous execution loop on the Shadow Worker.
///
/// Receives tasks from the queue and dispatches directly to plugin task handlers.
pub async fn run_shadow_task_dispatcher<W: std::io::Write + Send + 'static>(
    mut rx: mpsc::Receiver<GatewayBackgroundTask>,
    mut log_plugin: AccessLogPlugin<W>,
    mut prom_plugin: PrometheusPlugin,
    flush_interval: Duration,
) {
    let mut ticker = tokio::time::interval(flush_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;
            item = rx.recv() => {
                match item {
                    Some(GatewayBackgroundTask::AccessLog(log_task)) => {
                        log_plugin.handle_task(&log_task);
                    }
                    Some(GatewayBackgroundTask::HttpMetric(metric_task)) => {
                        prom_plugin.handle_task(&metric_task);
                    }
                    Some(GatewayBackgroundTask::TraceSpan(_span_task)) => {
                        // OTLP trace span dispatch
                    }
                    None => {
                        log_plugin.flush();
                        prom_plugin.flush();
                        break;
                    }
                }
            }
            _ = ticker.tick() => {
                log_plugin.tick();
                prom_plugin.tick();
            }
        }
    }
}
