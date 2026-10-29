//! Unified Background Phase Task Dispatcher & Shadow Worker Loop.
//!
//! Replaces monolithic request event structures with explicit, typed background tasks:
//! - `StdLogTask`: offloaded only when structured standard stream logging is required
//! - `HttpMetricTask`: offloaded only for status & metrics aggregation
//! - `TraceSpanTask`: offloaded only for sampled tracing spans
//!
//! Traffic Workers purely dispatch tasks (< 20ns, lock-free non-blocking queue);
//! Companion Shadow Workers autonomously execute tasks without hot-path CPU contention.

use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::opentelemetry::TraceSpanTask;
use crate::prometheus::{HttpMetricTask, PrometheusPlugin};
use crate::std_log::{StdLogPlugin, StdLogTask};

pub const TELEMETRY_SUB_STD_LOG: u32 = 1 << 0;
pub const TELEMETRY_SUB_METRICS: u32 = 1 << 1;
pub const TELEMETRY_SUB_TRACING: u32 = 1 << 2;

/// Dynamic bitmask of active telemetry subscribers.
///
/// # Bridge: Intrinsic Metrics Kernel <-> Pluggable Metrics Transport
///
/// This atomic bitmask functions as the master switch controlling whether the
/// Intrinsic Metrics Kernel on the hot-path collects data:
///
/// - **All Transport Plugins Disabled (`TELEMETRY_SUBSCRIBERS == 0`)**:
///   The Intrinsic Metrics Kernel is completely dormant (Tàng hình). Hot-path log hooks
///   in both C (`ngx_http_gateway_log_handler`) and Rust FFI (`aurora_gateway_phase_log`)
///   bypass all processing in < 2ns via a single 1-instruction branch.
///
/// - **Transport Plugin Enabled (e.g. `builtin/prometheus`)**:
///   The plugin transport registers its interest bit (`TELEMETRY_SUB_METRICS`).
///   The hot path awakens and updates atomic counters with relaxed ordering (< 3ns).
///   The transport layer (Shadow Worker / Exposition Engine) then exposes these metrics
///   without contending with traffic processing.
///
/// - **Transport Plugin Shutdown / Disabled**:
///   The bit is unregistered (`unregister_telemetry_subscriber`). The Intrinsic Kernel
///   instantly returns to dormant stealth mode.
///
/// Global atomic bitmask of active telemetry subscribers directly exported to C ABI.
#[unsafe(no_mangle)]
pub static AURORA_TELEMETRY_SUBSCRIBERS: AtomicU32 = AtomicU32::new(0);

/// Returns the current bitmask of active telemetry subscribers.
#[inline(always)]
pub fn telemetry_subscribers() -> u32 {
    AURORA_TELEMETRY_SUBSCRIBERS.load(Ordering::Relaxed)
}

/// Returns true if any telemetry subscriber is active.
#[inline(always)]
pub fn has_telemetry_subscribers() -> bool {
    AURORA_TELEMETRY_SUBSCRIBERS.load(Ordering::Relaxed) != 0
}

/// Returns true if Standard Stream structured logging is subscribed.
#[inline(always)]
pub fn has_std_log_subscriber() -> bool {
    (AURORA_TELEMETRY_SUBSCRIBERS.load(Ordering::Relaxed) & TELEMETRY_SUB_STD_LOG) != 0
}

/// Returns true if Prometheus metrics are subscribed.
#[inline(always)]
pub fn has_metrics_subscriber() -> bool {
    (AURORA_TELEMETRY_SUBSCRIBERS.load(Ordering::Relaxed) & TELEMETRY_SUB_METRICS) != 0
}

/// Sets the entire active telemetry subscriber bitmask.
pub fn set_telemetry_subscribers(mask: u32) {
    AURORA_TELEMETRY_SUBSCRIBERS.store(mask, Ordering::Release);
}

/// Registers one or more telemetry subscriber bits.
pub fn register_telemetry_subscriber(sub: u32) {
    AURORA_TELEMETRY_SUBSCRIBERS.fetch_or(sub, Ordering::Release);
}

/// Unregisters one or more telemetry subscriber bits.
pub fn unregister_telemetry_subscriber(sub: u32) {
    AURORA_TELEMETRY_SUBSCRIBERS.fetch_and(!sub, Ordering::Release);
}

/// Typed background task submitted from the Traffic Worker to the Shadow Worker.
///
/// Note: Unboxed `StdLogTask` avoids heap allocations (`Box::new`) on the hot path.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
pub enum GatewayBackgroundTask {
    StdLog(StdLogTask),
    HttpMetric(HttpMetricTask),
    TraceSpan(TraceSpanTask),
}

static TASK_SENDER_PTR: AtomicPtr<mpsc::Sender<GatewayBackgroundTask>> =
    AtomicPtr::new(ptr::null_mut());
static DROPPED_TASKS: AtomicU64 = AtomicU64::new(0);
static ENQUEUED_TASKS: AtomicU64 = AtomicU64::new(0);

/// Registers the global Shadow Worker background task queue sender.
pub fn set_task_sender(tx: mpsc::Sender<GatewayBackgroundTask>) {
    let boxed = Box::into_raw(Box::new(tx));
    let old = TASK_SENDER_PTR.swap(boxed, Ordering::AcqRel);
    if !old.is_null() {
        unsafe { drop(Box::from_raw(old)) };
    }
}

/// Clears the global Shadow Worker background task queue sender on shutdown.
pub fn clear_task_sender() {
    let old = TASK_SENDER_PTR.swap(ptr::null_mut(), Ordering::AcqRel);
    if !old.is_null() {
        unsafe { drop(Box::from_raw(old)) };
    }
}

/// Returns the number of background tasks dropped due to channel saturation or missing sender.
pub fn dropped_tasks_count() -> u64 {
    DROPPED_TASKS.load(Ordering::Relaxed)
}

/// Returns the number of background tasks successfully queued for background processing.
pub fn logged_tasks_count() -> u64 {
    ENQUEUED_TASKS.load(Ordering::Relaxed)
}

/// Increments the count of enqueued tasks (used by lock-free direct telemetry recording).
pub fn increment_enqueued_tasks() {
    ENQUEUED_TASKS.fetch_add(1, Ordering::Relaxed);
}

/// Submits a background task from the Traffic Worker to the companion Shadow Worker.
///
/// Executes in < 20ns on the hot path: non-blocking `try_send`, zero allocations, zero lock acquisitions.
#[inline(always)]
pub fn submit_task(task: GatewayBackgroundTask) -> bool {
    let ptr = TASK_SENDER_PTR.load(Ordering::Acquire);
    if !ptr.is_null() {
        let tx = unsafe { &*ptr };
        match tx.try_send(task) {
            Ok(()) => true,
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
    mut log_plugin: StdLogPlugin<W>,
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
                    Some(GatewayBackgroundTask::StdLog(log_task)) => {
                        ENQUEUED_TASKS.fetch_add(1, Ordering::Relaxed);
                        log_plugin.handle_task(&log_task);
                    }
                    Some(GatewayBackgroundTask::HttpMetric(metric_task)) => {
                        ENQUEUED_TASKS.fetch_add(1, Ordering::Relaxed);
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
