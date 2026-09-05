use std::fs;

/// Đọc thông tin % CPU sử dụng từ /proc/stat của Linux.
pub fn sample_cpu(last_total: &mut u64, last_idle: &mut u64) -> f64 {
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
