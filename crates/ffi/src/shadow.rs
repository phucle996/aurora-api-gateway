//! Shadow Worker C ABI Boundary
//!
//! Provides lifecycle hooks (`aurora_gateway_shadow_start`, `aurora_gateway_shadow_stop`)
//! invoked by NGINX C worker processes (`ngx_http_gateway_init_process` / `exit_process`).

use aurora_engine::shadow::{
    ShadowWorkerHandle, clear_core_shadow_sender, set_core_shadow_sender, spawn_shadow_worker,
    try_dispatch_shadow,
};
use std::sync::Mutex;

static ACTIVE_SHADOW_HANDLE: Mutex<Option<ShadowWorkerHandle>> = Mutex::new(None);
static CUSTOM_LOG_PATH: Mutex<Option<String>> = Mutex::new(None);

/// Sets the explicit structured log destination path passed from NGINX `gateway_std_log <path>`.
///
/// # Safety
/// `ptr` must point to valid UTF-8 memory of at least `len` bytes or be null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_set_log_path(ptr: *const u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
        if let (Ok(s), Ok(mut lock)) = (std::str::from_utf8(slice), CUSTOM_LOG_PATH.lock()) {
            *lock = Some(s.to_string());
        }
    }
}

/// Starts the Shadow Worker thread for this NGINX worker process.
/// Called from C: `ngx_http_gateway_init_process`.
///
/// # Safety
/// Must be called after `fork()` in each worker process.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_shadow_start(worker_id: u32) -> u32 {
    let mut lock = match ACTIVE_SHADOW_HANDLE.lock() {
        Ok(l) => l,
        Err(_) => return 1,
    };

    if lock.is_some() {
        return 0; // Already started
    }

    let core_id = None; // Can be configured with core affinity
    let channel_capacity = 1024;
    let (handle, tx) = spawn_shadow_worker(worker_id, core_id, channel_capacity);

    // Register sender for calling thread (NGINX worker thread)
    set_core_shadow_sender(tx);
    *lock = Some(handle);

    // Initialize Background Task channel and dispatch task runner to Shadow Worker
    let (task_tx, task_rx) = tokio::sync::mpsc::channel(8192);
    aurora_extensions::set_task_sender(task_tx);
    aurora_extensions::register_telemetry_subscriber(aurora_extensions::TELEMETRY_SUB_METRICS);

    if std::env::var("AURORA_STD_LOG").as_deref() == Ok("1")
        || std::env::var("AURORA_STD_LOG").as_deref() == Ok("true")
        || std::env::var("AURORA_STD_LOG_PATH").is_ok()
    {
        aurora_extensions::register_telemetry_subscriber(
            aurora_extensions::TELEMETRY_SUB_STD_LOG,
        );
    }

    let explicit_path = CUSTOM_LOG_PATH.lock().ok().and_then(|l| l.clone());
    let writer: Box<dyn std::io::Write + Send + 'static> = match explicit_path.or_else(|| std::env::var("AURORA_STD_LOG_PATH").ok()) {
        Some(path) if path == "stdout" => Box::new(std::io::stdout()),
        Some(path) if path == "stderr" => Box::new(std::io::stderr()),
        Some(path) if !path.is_empty() => match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(file) => Box::new(file),
            Err(e) => {
                eprintln!("Failed to open log path {path}: {e}, falling back to stdout");
                Box::new(std::io::stdout())
            }
        },
        _ => Box::new(std::io::stdout()),
    };

    let std_log_plugin = aurora_extensions::std_log::StdLogPlugin::new(writer, 256);
    let prom_plugin = aurora_extensions::PrometheusPlugin::new();
    let flush_interval = std::time::Duration::from_millis(100);

    let _ = try_dispatch_shadow(Box::pin(async move {
        aurora_extensions::run_shadow_task_dispatcher(
            task_rx,
            std_log_plugin,
            prom_plugin,
            flush_interval,
        )
        .await;
    }));

    0
}

/// Stops the Shadow Worker thread for this NGINX worker process.
/// Called from C: `ngx_http_gateway_exit_process`.
///
/// # Safety
/// Called once per worker process during shutdown.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_shadow_stop() -> u32 {
    aurora_extensions::set_telemetry_subscribers(0);
    aurora_extensions::clear_task_sender();
    clear_core_shadow_sender();
    let mut lock = match ACTIVE_SHADOW_HANDLE.lock() {
        Ok(l) => l,
        Err(_) => return 1,
    };

    if let Some(handle) = lock.take() {
        handle.shutdown();
    }

    0
}

/// Dispatches a test task through the Shadow hook to verify C ABI operation.
///
/// # Safety
/// Always safe to call from any thread; relies on non-blocking try-dispatch.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_shadow_dispatch_test() -> u32 {
    let task = Box::pin(async {
        // No-op smoke test task
    });
    if try_dispatch_shadow(task).is_ok() {
        0
    } else {
        1
    }
}
