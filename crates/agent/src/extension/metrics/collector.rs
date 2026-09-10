use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tracing::warn;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NodeMetrics {
    // System resource utilization (0.0 to 1.0)
    pub cpu_utilization: f64,
    pub memory_utilization: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,

    // NGINX stub_status counters and gauges
    pub active_connections: u64,
    pub connections_reading: u64,
    pub connections_writing: u64,
    pub connections_waiting: u64,
    pub connections_accepted: u64,
    pub connections_handled: u64,
    pub requests_total: u64,
}

pub struct CollectorState {
    last_cpu_total: AtomicU64,
    last_cpu_idle: AtomicU64,
    client: reqwest::Client,
}

impl Default for CollectorState {
    fn default() -> Self {
        Self {
            last_cpu_total: AtomicU64::new(0),
            last_cpu_idle: AtomicU64::new(0),
            client: reqwest::Client::builder()
                .timeout(Duration::from_millis(1500))
                .build()
                .unwrap_or_default(),
        }
    }
}

pub struct MetricsCollector {
    state: Arc<CollectorState>,
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            state: Arc::new(CollectorState::default()),
        }
    }

    /// On-demand collection: Only executes when actively called by an exporter sink.
    pub async fn collect(&self, stub_status_url: &str) -> NodeMetrics {
        let mut metrics = NodeMetrics::default();

        // 1. Sample Memory
        if let Some((used, total, ratio)) = sample_memory() {
            metrics.memory_used_bytes = used;
            metrics.memory_total_bytes = total;
            metrics.memory_utilization = ratio;
        }

        // 2. Sample CPU
        metrics.cpu_utilization = sample_cpu(&self.state.last_cpu_total, &self.state.last_cpu_idle);

        // 3. Scrape NGINX stub_status
        if !stub_status_url.is_empty() {
            match self.state.client.get(stub_status_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(body) = resp.text().await {
                        parse_stub_status(&body, &mut metrics);
                    }
                }
                Ok(resp) => {
                    warn!(
                        status = %resp.status(),
                        url = %stub_status_url,
                        "NGINX stub_status returned non-200 status"
                    );
                }
                Err(e) => {
                    // It's acceptable for stub_status to fail if NGINX is temporarily reloading or stub module not configured
                    tracing::debug!(url = %stub_status_url, error = %e, "Failed to scrape NGINX stub_status");
                }
            }
        }

        metrics
    }
}

/// Parses NGINX ngx_http_stub_status_module exposition:
/// Active connections: 291
/// server accepts handled requests
///  16630948 16630948 31070465
/// Reading: 6 Writing: 179 Waiting: 106
pub fn parse_stub_status(raw: &str, out: &mut NodeMetrics) {
    let lines: Vec<&str> = raw.lines().map(str::trim).collect();
    for line in lines {
        if line.starts_with("Active connections:") {
            if let Some(val) = line.strip_prefix("Active connections:").map(str::trim)
                && let Ok(parsed) = val.parse::<u64>()
            {
                out.active_connections = parsed;
            }
        } else if line.starts_with("Reading:") {
            // Format: Reading: 6 Writing: 179 Waiting: 106
            let parts: Vec<&str> = line.split_whitespace().collect();
            for i in 0..parts.len() {
                if parts[i] == "Reading:" && i + 1 < parts.len() {
                    out.connections_reading = parts[i + 1].parse().unwrap_or(0);
                } else if parts[i] == "Writing:" && i + 1 < parts.len() {
                    out.connections_writing = parts[i + 1].parse().unwrap_or(0);
                } else if parts[i] == "Waiting:" && i + 1 < parts.len() {
                    out.connections_waiting = parts[i + 1].parse().unwrap_or(0);
                }
            }
        } else {
            // Three numbers: accepts handled requests
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() == 3
                && let (Ok(acc), Ok(hnd), Ok(req)) = (
                    parts[0].parse::<u64>(),
                    parts[1].parse::<u64>(),
                    parts[2].parse::<u64>(),
                )
            {
                out.connections_accepted = acc;
                out.connections_handled = hnd;
                out.requests_total = req;
            }
        }
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

    // 2. Connection and Request Counters
    out.push_str("# HELP http_connections_handled_total Total number of handled connections\n");
    out.push_str("# TYPE http_connections_handled_total counter\n");
    out.push_str(&format!(
        "http_connections_handled_total{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_handled
    ));

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
        "system_memory_total_bytes{{node_id=\"{}\"}} {}\n",
        node_id, m.memory_total_bytes
    ));

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stub_status_valid() {
        let sample = "\
Active connections: 291 
server accepts handled requests
 16630948 16630948 31070465 
Reading: 6 Writing: 179 Waiting: 106 
";
        let mut m = NodeMetrics::default();
        parse_stub_status(sample, &mut m);

        assert_eq!(m.active_connections, 291);
        assert_eq!(m.connections_accepted, 16630948);
        assert_eq!(m.connections_handled, 16630948);
        assert_eq!(m.requests_total, 31070465);
        assert_eq!(m.connections_reading, 6);
        assert_eq!(m.connections_writing, 179);
        assert_eq!(m.connections_waiting, 106);
    }

    #[test]
    fn test_parse_stub_status_empty() {
        let mut m = NodeMetrics::default();
        parse_stub_status("", &mut m);
        assert_eq!(m.active_connections, 0);
        assert_eq!(m.requests_total, 0);
    }

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
            connections_accepted: 1000,
            connections_handled: 1000,
            requests_total: 5000,
        };

        let formatted = format_prometheus("node-test-01", &m);

        // Verify standard metrics presence
        assert!(formatted.contains("http_connections_active{node_id=\"node-test-01\"} 42"));
        assert!(formatted.contains("http_connections_reading{node_id=\"node-test-01\"} 2"));
        assert!(formatted.contains("http_connections_writing{node_id=\"node-test-01\"} 10"));
        assert!(formatted.contains("http_connections_waiting{node_id=\"node-test-01\"} 30"));
        assert!(
            formatted.contains("http_connections_handled_total{node_id=\"node-test-01\"} 1000")
        );
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
}
