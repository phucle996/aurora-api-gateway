use std::fs;

/// Đọc thông tin % CPU sử dụng từ /proc/stat của Linux.
pub fn sample_cpu(last_total: &mut u64, last_idle: &mut u64) -> f64 {
    if metrics_scope() == "container" {
        // These paths are scoped only with a private cgroup v2 namespace.
        // A host cgroup namespace must not turn this into a host measurement.
        if fs::read_to_string("/proc/self/cgroup")
            .ok()
            .as_deref()
            .map(str::trim)
            != Some("0::/")
        {
            return f64::NAN;
        }
        // cgroup v2: normalize usage to the container CPU allocation. Missing
        // cgroup counters must never silently become host utilization.
        let sampled = (|| -> Option<(u64, u64, f64)> {
            let stat = fs::read_to_string("/sys/fs/cgroup/cpu.stat").ok()?;
            let usage = stat
                .lines()
                .find_map(|l| l.strip_prefix("usage_usec "))?
                .parse::<u64>()
                .ok()?;
            let uptime = fs::read_to_string("/proc/uptime").ok()?;
            let wall =
                (uptime.split_whitespace().next()?.parse::<f64>().ok()? * 1_000_000.0) as u64;
            let cpus = fs::read_to_string("/sys/fs/cgroup/cpuset.cpus.effective").ok()?;
            let mut capacity = 0.0_f64;
            for range in cpus.trim().split(',') {
                let mut ends = range.split('-');
                let first = ends.next()?.parse::<u64>().ok()?;
                let last = ends
                    .next()
                    .map(str::parse::<u64>)
                    .transpose()
                    .ok()?
                    .unwrap_or(first);
                capacity += last.checked_sub(first)? as f64 + 1.0;
            }
            let max = fs::read_to_string("/sys/fs/cgroup/cpu.max").ok()?;
            let mut parts = max.split_whitespace();
            let quota = parts.next()?;
            let period = parts.next()?.parse::<f64>().ok()?;
            if quota != "max" {
                capacity = capacity.min(quota.parse::<f64>().ok()? / period);
            }
            (capacity > 0.0 && capacity.is_finite()).then_some((wall, usage, capacity))
        })();
        if let Some((wall, usage, capacity)) = sampled {
            let value = if *last_total > 0 && wall > *last_total && usage >= *last_idle {
                ((usage - *last_idle) as f64 / (wall - *last_total) as f64 / capacity * 100.0)
                    .clamp(0.0, 100.0)
            } else {
                f64::NAN
            };
            *last_total = wall;
            *last_idle = usage;
            return value;
        }
        return f64::NAN;
    }
    if metrics_scope() != "host" {
        return f64::NAN;
    }
    if let Ok(content) = fs::read_to_string("/proc/stat") {
        for line in content.lines() {
            if line.starts_with("cpu ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    let user: u64 = parts[1].parse().unwrap_or(0);
                    let nice: u64 = parts[2].parse().unwrap_or(0);
                    let system: u64 = parts[3].parse().unwrap_or(0);
                    let idle: u64 = parts[4].parse::<u64>().unwrap_or(0)
                        + parts
                            .get(5)
                            .and_then(|v| v.parse::<u64>().ok())
                            .unwrap_or(0);

                    let mut total = user + nice + system + idle;
                    // iowait is idle; guest/guest_nice already included in user/nice.
                    for part in parts.iter().take(9).skip(6) {
                        total += part.parse::<u64>().unwrap_or(0);
                    }

                    if *last_total > 0 && total > *last_total && idle >= *last_idle {
                        let diff_total = (total - *last_total) as f64;
                        let diff_idle = (idle - *last_idle) as f64;
                        *last_total = total;
                        *last_idle = idle;
                        let usage = (1.0 - (diff_idle / diff_total)) * 100.0;
                        return usage.clamp(0.0, 100.0);
                    }

                    *last_total = total;
                    *last_idle = idle;
                    return f64::NAN;
                }
            }
        }
    }
    f64::NAN
}

/// Đọc thông tin % RAM sử dụng từ /proc/meminfo của Linux.
pub fn sample_memory() -> f64 {
    if metrics_scope() == "container" {
        // These paths are scoped only with a private cgroup v2 namespace.
        // A host cgroup namespace must not turn this into a host measurement.
        if fs::read_to_string("/proc/self/cgroup")
            .ok()
            .as_deref()
            .map(str::trim)
            != Some("0::/")
        {
            return f64::NAN;
        }
        let sampled = (|| -> Option<f64> {
            let current = fs::read_to_string("/sys/fs/cgroup/memory.current")
                .ok()?
                .trim()
                .parse::<u64>()
                .ok()?;
            let stat = fs::read_to_string("/sys/fs/cgroup/memory.stat").ok()?;
            let inactive = stat
                .lines()
                .find_map(|l| l.strip_prefix("inactive_file "))?
                .parse::<u64>()
                .ok()?;
            let max = fs::read_to_string("/sys/fs/cgroup/memory.max").ok()?;
            let host = fs::read_to_string("/proc/meminfo").ok()?;
            let total = host
                .lines()
                .find_map(|l| l.strip_prefix("MemTotal:"))?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)?;
            let limit = if max.trim() == "max" {
                total
            } else {
                max.trim().parse::<u64>().ok()?.min(total)
            };
            (limit > 0).then_some(current.saturating_sub(inactive) as f64 / limit as f64 * 100.0)
        })();
        return sampled.unwrap_or(f64::NAN);
    }
    if metrics_scope() != "host" {
        return f64::NAN;
    }
    if let Ok(content) = fs::read_to_string("/proc/meminfo") {
        let mut total: u64 = 0;
        let mut avail: u64 = 0;

        for line in content.lines() {
            if line.starts_with("MemTotal:") {
                if let Some(val) = line.split_whitespace().nth(1) {
                    total = val.parse().unwrap_or(0);
                }
            } else if line.starts_with("MemAvailable:")
                && let Some(val) = line.split_whitespace().nth(1)
            {
                avail = val.parse().unwrap_or(0);
            }
        }

        if total > 0 && avail > 0 && total >= avail {
            return (((total - avail) as f64) / (total as f64)) * 100.0;
        }
    }
    f64::NAN
}

/// Container detection takes precedence over a host override. Unsupported scopes
/// fail unavailable; host counters are only enabled for the systemd deployment.
pub fn metrics_scope() -> &'static str {
    if std::path::Path::new("/.dockerenv").exists()
        || std::path::Path::new("/run/.containerenv").exists()
        || std::env::var("AURORA_METRICS_SCOPE").as_deref() == Ok("container")
    {
        "container"
    } else if std::env::var("AURORA_METRICS_SCOPE").as_deref() == Ok("host") {
        "host"
    } else {
        "unknown"
    }
}

/// PID 1 owns the container lifetime; the NGINX master owns a systemd service
/// lifetime. /proc start ticks survive worker reloads and reset on restart.
pub fn runtime_started_at() -> i64 {
    let pid = if metrics_scope() == "container" {
        1
    } else {
        unsafe { libc::getppid() }
    };
    let start = (|| -> Option<i64> {
        let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let ticks = stat
            .rsplit_once(") ")?
            .1
            .split_whitespace()
            .nth(19)?
            .parse::<u64>()
            .ok()?;
        let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        if hz <= 0 {
            return None;
        }
        let system = fs::read_to_string("/proc/stat").ok()?;
        let boot = system
            .lines()
            .find_map(|l| l.strip_prefix("btime "))?
            .parse::<i64>()
            .ok()?;
        Some(boot + (ticks / hz as u64) as i64)
    })();
    start.unwrap_or(0)
}
