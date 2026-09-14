use aurora_engine::telemetry::{
    GatewayMetricsSnapshot, GatewaySharedMetrics, SHM_DEFAULT_PATH, SHM_FALLBACK_PATH,
    SHM_SIZE_BYTES, TELEMETRY_MAGIC,
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

        // Try candidate shared memory paths
        let candidates = [SHM_DEFAULT_PATH, SHM_FALLBACK_PATH];
        for path in candidates {
            if let Ok(file) = fs::OpenOptions::new().read(true).open(path) {
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
        .skip(1) // skip "cpu"
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();

    if fields.len() < 4 {
        return 0.0;
    }

    let idle = fields[3] + fields.get(4).copied().unwrap_or(0); // idle + iowait
    let total: u64 = fields.iter().sum();

    let prev_total = last_total.swap(total, Ordering::AcqRel);
    let prev_idle = last_idle.swap(idle, Ordering::AcqRel);

    if prev_total == 0 || total <= prev_total {
        // First sample, return baseline estimation
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

/// Format NodeMetrics into standard Prometheus Exposition text format.
/// Adheres strictly to standard naming conventions WITHOUT prefix 'aurora_'.
pub fn format_prometheus(node_id: &str, m: &NodeMetrics) -> String {
    let mut out = String::with_capacity(1024);

    // 1. Connection Gauges
    out.push_str("# HELP http_connections_active Number of active client connections\n");
    out.push_str("# TYPE http_connections_active gauge\n");
    out.push_str(&format!(
        "http_connections_active{{node_id=\"{}\"}} {}\n\n",
        node_id, m.active_connections
    ));

    out.push_str("# HELP http_connections_reading Number of connections reading request headers\n");
    out.push_str("# TYPE http_connections_reading gauge\n");
    out.push_str(&format!(
        "http_connections_reading{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_reading
    ));

    out.push_str("# HELP http_connections_writing Number of connections writing response\n");
    out.push_str("# TYPE http_connections_writing gauge\n");
    out.push_str(&format!(
        "http_connections_writing{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_writing
    ));

    out.push_str("# HELP http_connections_waiting Number of idle keepalive connections\n");
    out.push_str("# TYPE http_connections_waiting gauge\n");
    out.push_str(&format!(
        "http_connections_waiting{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_waiting
    ));

    // 2. Request Counter
    out.push_str("# HELP http_requests_total Total number of HTTP requests processed\n");
    out.push_str("# TYPE http_requests_total counter\n");
    out.push_str(&format!(
        "http_requests_total{{node_id=\"{}\"}} {}\n\n",
        node_id, m.requests_total
    ));

    // 3. System Utilization Gauges
    out.push_str(
        "# HELP system_cpu_utilization_ratio Current CPU utilization ratio (0.0 to 1.0)\n",
    );
    out.push_str("# TYPE system_cpu_utilization_ratio gauge\n");
    out.push_str(&format!(
        "system_cpu_utilization_ratio{{node_id=\"{}\"}} {:.4}\n\n",
        node_id, m.cpu_utilization
    ));

    out.push_str(
        "# HELP system_memory_utilization_ratio Current Memory utilization ratio (0.0 to 1.0)\n",
    );
    out.push_str("# TYPE system_memory_utilization_ratio gauge\n");
    out.push_str(&format!(
        "system_memory_utilization_ratio{{node_id=\"{}\"}} {:.4}\n\n",
        node_id, m.memory_utilization
    ));

    out.push_str("# HELP system_memory_used_bytes Memory used in bytes\n");
    out.push_str("# TYPE system_memory_used_bytes gauge\n");
    out.push_str(&format!(
        "system_memory_used_bytes{{node_id=\"{}\"}} {}\n\n",
        node_id, m.memory_used_bytes
    ));

    out.push_str("# HELP system_memory_total_bytes Total system memory in bytes\n");
    out.push_str("# TYPE system_memory_total_bytes gauge\n");
    out.push_str(&format!(
        "system_memory_total_bytes{{node_id=\"{}\"}} {}\n\n",
        node_id, m.memory_total_bytes
    ));

    // 4. Gateway HTTP Requests by Status Class
    let g = &m.gateway;
    out.push_str("# HELP gateway_http_requests_total Total HTTP requests processed by Gateway\n");
    out.push_str("# TYPE gateway_http_requests_total counter\n");
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"2xx\"}} {}\n",
        g.http_status_2xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"3xx\"}} {}\n",
        g.http_status_3xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"4xx\"}} {}\n",
        g.http_status_4xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"5xx\"}} {}\n",
        g.http_status_5xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"other\"}} {}\n\n",
        g.http_status_other
    ));

    // 5. Gateway HTTP Request Latency Histogram
    out.push_str("# HELP gateway_http_request_duration_seconds HTTP request duration in seconds\n");
    out.push_str("# TYPE gateway_http_request_duration_seconds histogram\n");
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.001\"}} {}\n",
        g.http_duration_bucket_1ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.005\"}} {}\n",
        g.http_duration_bucket_5ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.010\"}} {}\n",
        g.http_duration_bucket_10ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.050\"}} {}\n",
        g.http_duration_bucket_50ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.100\"}} {}\n",
        g.http_duration_bucket_100ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.500\"}} {}\n",
        g.http_duration_bucket_500ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"1.000\"}} {}\n",
        g.http_duration_bucket_1000ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"+Inf\"}} {}\n",
        g.http_duration_bucket_inf
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_sum{{node_id=\"{node_id}\"}} {:.3}\n",
        g.http_duration_sum_ms as f64 / 1000.0
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_count{{node_id=\"{node_id}\"}} {}\n\n",
        g.http_requests_total
    ));

    // 6. Core WAF Decisions
    out.push_str("# HELP gateway_waf_evaluations_total Core WAF evaluations\n");
    out.push_str("# TYPE gateway_waf_evaluations_total counter\n");
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"allow\"}} {}\n",
        g.waf_allow
    ));
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"block\"}} {}\n",
        g.waf_block
    ));
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"audit\"}} {}\n\n",
        g.waf_audit
    ));

    // 7. Rate Limiting Decisions
    out.push_str("# HELP gateway_ratelimit_requests_total Rate limit decisions\n");
    out.push_str("# TYPE gateway_ratelimit_requests_total counter\n");
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"allowed\"}} {}\n",
        g.ratelimit_allowed
    ));
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"throttled\"}} {}\n",
        g.ratelimit_throttled
    ));
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"rejected\"}} {}\n\n",
        g.ratelimit_rejected
    ));

    // 8. JWT Authentication Decisions
    out.push_str("# HELP gateway_jwt_validations_total JWT authentication decisions\n");
    out.push_str("# TYPE gateway_jwt_validations_total counter\n");
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"valid\"}} {}\n",
        g.jwt_valid
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"invalid\"}} {}\n",
        g.jwt_invalid
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"expired\"}} {}\n",
        g.jwt_expired
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"missing\"}} {}\n\n",
        g.jwt_missing
    ));

    // 9. Access Control Decisions
    out.push_str("# HELP gateway_access_evaluations_total Access control decisions\n");
    out.push_str("# TYPE gateway_access_evaluations_total counter\n");
    out.push_str(&format!(
        "gateway_access_evaluations_total{{node_id=\"{node_id}\",action=\"allow\"}} {}\n",
        g.access_allow
    ));
    out.push_str(&format!(
        "gateway_access_evaluations_total{{node_id=\"{node_id}\",action=\"block\"}} {}\n\n",
        g.access_block
    ));

    // 10. Routing Extensions
    out.push_str("# HELP gateway_canary_requests_total Canary release routing decisions\n");
    out.push_str("# TYPE gateway_canary_requests_total counter\n");
    out.push_str(&format!(
        "gateway_canary_requests_total{{node_id=\"{node_id}\",slot=\"baseline\"}} {}\n",
        g.canary_baseline
    ));
    out.push_str(&format!(
        "gateway_canary_requests_total{{node_id=\"{node_id}\",slot=\"canary\"}} {}\n\n",
        g.canary_canary
    ));

    out.push_str("# HELP gateway_traffic_split_requests_total Traffic split routing decisions\n");
    out.push_str("# TYPE gateway_traffic_split_requests_total counter\n");
    out.push_str(&format!(
        "gateway_traffic_split_requests_total{{node_id=\"{node_id}\",branch=\"primary\"}} {}\n",
        g.traffic_split_primary
    ));
    out.push_str(&format!(
        "gateway_traffic_split_requests_total{{node_id=\"{node_id}\",branch=\"secondary\"}} {}\n\n",
        g.traffic_split_secondary
    ));

    out.push_str(
        "# HELP gateway_conn_limit_rejected_total Connection limit rejected connections\n",
    );
    out.push_str("# TYPE gateway_conn_limit_rejected_total counter\n");
    out.push_str(&format!(
        "gateway_conn_limit_rejected_total{{node_id=\"{node_id}\"}} {}\n\n",
        g.conn_limit_rejected
    ));

    out.push_str("# HELP gateway_request_termination_total Terminated requests\n");
    out.push_str("# TYPE gateway_request_termination_total counter\n");
    out.push_str(&format!(
        "gateway_request_termination_total{{node_id=\"{node_id}\"}} {}\n\n",
        g.termination_triggered
    ));

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_prometheus_no_aurora_prefix() {
        let m = NodeMetrics {
            cpu_utilization: 0.1523,
            memory_utilization: 0.4567,
            memory_used_bytes: 4000000000,
            memory_total_bytes: 8000000000,
            active_connections: 42,
            connections_reading: 2,
            connections_writing: 10,
            connections_waiting: 30,
            requests_total: 5000,
            gateway: GatewayMetricsSnapshot::default(),
        };

        let formatted = format_prometheus("node-test-01", &m);

        // Verify standard metrics presence
        assert!(formatted.contains("http_connections_active{node_id=\"node-test-01\"} 42"));
        assert!(formatted.contains("http_connections_reading{node_id=\"node-test-01\"} 2"));
        assert!(formatted.contains("http_connections_writing{node_id=\"node-test-01\"} 10"));
        assert!(formatted.contains("http_connections_waiting{node_id=\"node-test-01\"} 30"));
        assert!(formatted.contains("http_requests_total{node_id=\"node-test-01\"} 5000"));
        assert!(
            formatted.contains("system_cpu_utilization_ratio{node_id=\"node-test-01\"} 0.1523")
        );
        assert!(
            formatted.contains("system_memory_utilization_ratio{node_id=\"node-test-01\"} 0.4567")
        );

        // Crucial invariant: Absolutely NO aurora_ prefix in metric names
        assert!(!formatted.contains("aurora_"));
    }

    #[test]
    fn test_format_prometheus_with_gateway_metrics() {
        let mut m = NodeMetrics::default();
        m.gateway.http_requests_total = 100;
        m.gateway.http_status_2xx = 95;
        m.gateway.http_status_4xx = 5;
        m.gateway.http_duration_bucket_5ms = 80;
        m.gateway.http_duration_bucket_inf = 100;
        m.gateway.http_duration_sum_ms = 450;
        m.gateway.ratelimit_rejected = 3;
        m.gateway.jwt_valid = 90;
        m.gateway.jwt_invalid = 2;
        m.gateway.canary_canary = 20;

        let formatted = format_prometheus("node-01", &m);
        assert!(
            formatted
                .contains("gateway_http_requests_total{node_id=\"node-01\",status=\"2xx\"} 95")
        );
        assert!(
            formatted.contains("gateway_http_requests_total{node_id=\"node-01\",status=\"4xx\"} 5")
        );
        assert!(formatted.contains(
            "gateway_http_request_duration_seconds_bucket{node_id=\"node-01\",le=\"0.005\"} 80"
        ));
        assert!(
            formatted
                .contains("gateway_http_request_duration_seconds_sum{node_id=\"node-01\"} 0.450")
        );
        assert!(formatted.contains(
            "gateway_ratelimit_requests_total{node_id=\"node-01\",action=\"rejected\"} 3"
        ));
        assert!(
            formatted
                .contains("gateway_jwt_validations_total{node_id=\"node-01\",status=\"valid\"} 90")
        );
        assert!(
            formatted
                .contains("gateway_canary_requests_total{node_id=\"node-01\",slot=\"canary\"} 20")
        );
    }
}
