use aurora_engine::telemetry::{
    GatewayMetricsSnapshot, GatewaySharedMetrics, SHM_DEFAULT_PATH, SHM_SIZE_BYTES, TELEMETRY_MAGIC,
};
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NodeMetrics {
    // System resource utilization (0.0 to 1.0)
    pub cpu_utilization: f64,
    pub memory_utilization: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,

    // NGINX connection state (sourced from Shared Memory)
    pub active_connections: u64,
    pub connections_reading: u64,
    pub connections_writing: u64,
    pub connections_waiting: u64,
    pub requests_total: u64,

    // Data-Plane Gateway & Extension Metrics (read from Shared Memory)
    pub gateway: GatewayMetricsSnapshot,
}

struct ShmMapping {
    ptr: *const GatewaySharedMetrics,
}
unsafe impl Send for ShmMapping {}
unsafe impl Sync for ShmMapping {}

impl Drop for ShmMapping {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                libc::munmap(self.ptr as *mut libc::c_void, SHM_SIZE_BYTES);
            }
        }
    }
}

pub struct CollectorState {
    last_cpu_total: AtomicU64,
    last_cpu_idle: AtomicU64,
    shm: Mutex<Option<ShmMapping>>,
}

impl Default for CollectorState {
    fn default() -> Self {
        Self {
            last_cpu_total: AtomicU64::new(0),
            last_cpu_idle: AtomicU64::new(0),
            shm: Mutex::new(None),
        }
    }
}

pub struct MetricsCollector {
    state: Arc<CollectorState>,
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            state: Arc::new(CollectorState::default()),
        }
    }

    fn read_gateway_metrics(&self) -> GatewayMetricsSnapshot {
        let mut guard = match self.state.shm.lock() {
            Ok(g) => g,
            Err(_) => return GatewayMetricsSnapshot::default(),
        };

        if let Some(mapping) = guard.as_ref()
            && !mapping.ptr.is_null()
            && unsafe { (*mapping.ptr).magic } == TELEMETRY_MAGIC
        {
            return unsafe { (*mapping.ptr).snapshot() };
        }

        if let Ok(file) = fs::OpenOptions::new().read(true).open(SHM_DEFAULT_PATH) {
            let fd = std::os::unix::io::AsRawFd::as_raw_fd(&file);
            let mmap_ptr = unsafe {
                libc::mmap(
                    std::ptr::null_mut(),
                    SHM_SIZE_BYTES,
                    libc::PROT_READ,
                    libc::MAP_SHARED,
                    fd,
                    0,
                )
            };
            if mmap_ptr != libc::MAP_FAILED && !mmap_ptr.is_null() {
                let metrics = mmap_ptr as *const GatewaySharedMetrics;
                if unsafe { (*metrics).magic } == TELEMETRY_MAGIC {
                    let snap = unsafe { (*metrics).snapshot() };
                    *guard = Some(ShmMapping { ptr: metrics });
                    return snap;
                } else {
                    unsafe { libc::munmap(mmap_ptr, SHM_SIZE_BYTES) };
                }
            }
        }
        GatewayMetricsSnapshot::default()
    }

    /// On-demand collection: Only executes when actively called by an exporter sink.
    pub async fn collect(&self) -> NodeMetrics {
        let mut metrics = NodeMetrics::default();

        // 1. Sample Memory
        if let Some((used, total, ratio)) = sample_memory() {
            metrics.memory_used_bytes = used;
            metrics.memory_total_bytes = total;
            metrics.memory_utilization = ratio;
        }

        // 2. Sample CPU
        metrics.cpu_utilization = sample_cpu(&self.state.last_cpu_total, &self.state.last_cpu_idle);

        // 3. Sample Gateway & Extension Data-Plane Metrics from Shared Memory
        metrics.gateway = self.read_gateway_metrics();

        // Read NGINX connection metrics directly from Shared Memory (zero network overhead, lockless)
        metrics.active_connections = metrics.gateway.connections_active;
        metrics.connections_reading = metrics.gateway.connections_reading;
        metrics.connections_writing = metrics.gateway.connections_writing;
        metrics.connections_waiting = metrics.gateway.connections_waiting;
        metrics.requests_total = metrics.gateway.http_requests_total;

        metrics
    }
}

/// Read memory stats from Linux /proc/meminfo or /sys/fs/cgroup.
/// Returns (used_bytes, total_bytes, ratio).
pub fn sample_memory() -> Option<(u64, u64, f64)> {
    // 1. Check cgroup v2 memory first (if running inside container)
    let cgroup_stats = (
        fs::read_to_string("/sys/fs/cgroup/memory.current"),
        fs::read_to_string("/sys/fs/cgroup/memory.max"),
    );
    if let (Ok(current_str), Ok(max_str)) = cgroup_stats {
        let parsed = (
            current_str.trim().parse::<u64>(),
            max_str.trim().parse::<u64>(),
        );
        if let (Ok(current), Ok(max)) = parsed
            && max > 0
        {
            let ratio = (current as f64 / max as f64).clamp(0.0, 1.0);
            return Some((current, max, ratio));
        }
    }

    // 2. Fallback to /proc/meminfo for Linux host / VM
    let meminfo = fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb = 0u64;
    let mut available_kb = 0u64;

    for line in meminfo.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        } else if line.starts_with("MemAvailable:") {
            available_kb = line.split_whitespace().nth(1)?.parse::<u64>().ok()?;
        }
    }

    if total_kb > 0 {
        let used_kb = total_kb.saturating_sub(available_kb);
        let ratio = (used_kb as f64 / total_kb as f64).clamp(0.0, 1.0);
        Some((used_kb * 1024, total_kb * 1024, ratio))
    } else {
        None
    }
}

/// Read CPU utilization from Linux /proc/stat.
pub fn sample_cpu(last_total: &AtomicU64, last_idle: &AtomicU64) -> f64 {
    let stat = match fs::read_to_string("/proc/stat") {
        Ok(s) => s,
        Err(_) => return 0.0,
    };

    let first_line = match stat.lines().next() {
        Some(l) if l.starts_with("cpu ") => l,
        _ => return 0.0,
    };

    let fields: Vec<u64> = first_line
        .split_whitespace()
        .skip(1)
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();

    if fields.len() < 4 {
        return 0.0;
    }

    let idle = fields[3] + fields.get(4).copied().unwrap_or(0);
    let total: u64 = fields.iter().sum();

    let prev_total = last_total.swap(total, Ordering::AcqRel);
    let prev_idle = last_idle.swap(idle, Ordering::AcqRel);

    if prev_total == 0 || total <= prev_total {
        let non_idle = total.saturating_sub(idle);
        if total > 0 {
            (non_idle as f64 / total as f64).clamp(0.0, 1.0)
        } else {
            0.0
        }
    } else {
        let diff_total = total - prev_total;
        let diff_idle = idle.saturating_sub(prev_idle);
        let diff_active = diff_total.saturating_sub(diff_idle);
        (diff_active as f64 / diff_total as f64).clamp(0.0, 1.0)
    }
}
