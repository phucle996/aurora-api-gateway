//! Module quản lý thu thập và gửi Telemetry Heartbeat trực tiếp từ NGINX Worker.
//! Chạy trên một OS Thread riêng biệt, gửi protobuf binary (~37 bytes) mỗi chu kỳ (mặc định 10s).

pub mod client;
pub mod prometheus;
pub mod protobuf;
pub mod sampler;
pub mod state;

use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub use prometheus::format_prometheus_metrics;
pub use protobuf::HeartbeatPayload;
pub use state::{bind, record_evaluation};

use client::post_protobuf;
use sampler::{sample_cpu, sample_memory};
use state::{TELEMETRY_RUNNING, TOTAL_EVALUATIONS, active_connections, shared_slot};

/// Khởi chạy Background Telemetry Thread.
pub fn start_telemetry(
    controller_url: &str,
    node_id: &str,
    token: &str,
    interval_seconds: u32,
    active_release_id: i64,
) -> bool {
    if TELEMETRY_RUNNING.swap(true, Ordering::SeqCst) {
        // Đã chạy rồi, không khởi chạy lần thứ 2
        return true;
    }

    let url = controller_url.to_string();
    let nid = node_id.to_string();
    let tok = token.to_string();
    let interval = if interval_seconds == 0 {
        10
    } else {
        interval_seconds
    };
    let owner = u64::from(std::process::id());
    if let Some(slot) = shared_slot(3) {
        slot.store(owner, Ordering::Release);
    }

    let spawn_res = thread::Builder::new()
        .name("aurora-telemetry".into())
        .spawn(move || {
            let mut last_cpu_total = 0u64;
            let mut last_cpu_idle = 0u64;
            let mut last_eval_count = shared_slot(0)
                .unwrap_or(&TOTAL_EVALUATIONS)
                .load(Ordering::Relaxed);
            let mut last_time = Instant::now();

            // Phase Stagger ban đầu: Tự động phân tán thời điểm gửi nhịp tim đầu tiên của node
            // trong khoảng [0, interval) để tránh thundering herd trong cụm máy chủ.
            let initial_delay_secs = calculate_initial_stagger(&nid, interval);
            if initial_delay_secs > 0 {
                for _ in 0..(initial_delay_secs * 2) {
                    if !TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                        return;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
            }

            while TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                if shared_slot(3).is_some_and(|slot| slot.load(Ordering::Acquire) != owner) {
                    break;
                }
                let now = Instant::now();
                let elapsed_secs = now.duration_since(last_time).as_secs_f64();

                let cpu = sample_cpu(&mut last_cpu_total, &mut last_cpu_idle);
                let mem = sample_memory();

                let current_eval_count = shared_slot(0)
                    .unwrap_or(&TOTAL_EVALUATIONS)
                    .load(Ordering::Relaxed);
                let rps = if elapsed_secs > 0.0 && current_eval_count >= last_eval_count {
                    (current_eval_count - last_eval_count) as f64 / elapsed_secs
                } else {
                    0.0
                };
                last_eval_count = current_eval_count;
                last_time = now;

                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);

                if !cpu.is_finite() || !mem.is_finite() {
                    thread::sleep(Duration::from_secs(1));
                    continue;
                }
                if let Some(slot) = shared_slot(4) {
                    slot.store(cpu.to_bits(), Ordering::Relaxed);
                }
                if let Some(slot) = shared_slot(5) {
                    slot.store(mem.to_bits(), Ordering::Relaxed);
                }
                if let Some(slot) = shared_slot(6) {
                    slot.store(rps.to_bits(), Ordering::Relaxed);
                }
                if let Some(slot) = shared_slot(7) {
                    slot.store(ts as u64, Ordering::Release);
                }
                let node_version = std::env::var("NODE_VERSION")
                    .or_else(|_| std::env::var("NGINX_VERSION"))
                    .unwrap_or_else(|_| {
                        std::process::Command::new("/opt/nginx/usr/sbin/nginx")
                            .arg("-v")
                            .output()
                            .or_else(|_| std::process::Command::new("nginx").arg("-v").output())
                            .ok()
                            .and_then(|out| {
                                let s = String::from_utf8_lossy(&out.stderr);
                                s.split("nginx/").nth(1).map(|v| v.trim().to_string())
                            })
                            .unwrap_or_else(|| "1.30.4".to_string())
                    });
                let node_role = std::env::var("NODE_ROLE").unwrap_or_default();

                let payload = HeartbeatPayload {
                    node_id: nid.clone(),
                    timestamp: ts,
                    cpu_usage: cpu,
                    memory_usage: mem,
                    active_connections: active_connections().unwrap_or(0).min(i64::MAX as u64)
                        as i64,
                    requests_per_second: rps,
                    active_release_id,
                    version: node_version,
                    role: node_role,
                };

                let bytes = payload.to_protobuf_bytes();
                if let Err(err) = post_protobuf(&url, &nid, &tok, &bytes) {
                    eprintln!("[Aurora WAF Telemetry] Warning: post heartbeat failed: {err}");
                }

                // Phân tán chu kỳ với dynamic jitter (+/- 1.5s) để chống hiện tượng phase locking khi chạy dài hạn
                let cycle_seed = (ts as u64).wrapping_add(nid.len() as u64);
                let jitter_ms = ((cycle_seed % 3000) as i64) - 1500;
                let sleep_ms = ((interval as i64 * 1000) + jitter_ms).max(1000) as u64;

                let step_ms = 500u64;
                let steps = sleep_ms / step_ms;
                for _ in 0..steps {
                    if !TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(step_ms));
                }
            }
        });

    spawn_res.is_ok()
}

/// Tính toán độ lệch pha ban đầu (initial phase stagger) cho node trong khoảng [0, interval).
/// Đảm bảo các node trong cụm tự động rải đều nhịp tim trên trục thời gian mà không cần can thiệp script bên ngoài.
fn calculate_initial_stagger(node_id: &str, interval_seconds: u32) -> u64 {
    if interval_seconds <= 1 {
        return 0;
    }
    let interval = interval_seconds as u64;

    // 1. Nếu node có hậu tố số (như node-01, node-02, edge-3...), rải đều theo bước nhảy 5s
    let trailing_num = node_id
        .trim_end_matches(|c: char| !c.is_ascii_digit())
        .rsplit(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|s| s.parse::<u64>().ok());

    if let Some(num) = trailing_num {
        if num > 0 {
            return (num.wrapping_sub(1) * 5) % interval;
        }
    }

    // 2. Với các tên node không chứa số (ví dụ: edge-primary, waf-tokyo...), dùng FNV hash phân tán đều
    let hash_val = node_id
        .bytes()
        .fold(0u64, |acc, b| acc.wrapping_mul(1099511628211) ^ (b as u64));
    hash_val % interval
}

/// Dừng Background Telemetry Thread khi NGINX worker exit.
pub fn stop_telemetry() {
    TELEMETRY_RUNNING.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protobuf_encoding_roundtrip() {
        let payload = HeartbeatPayload {
            node_id: "node-local-01".into(),
            timestamp: 1725520000,
            cpu_usage: 12.5,
            memory_usage: 45.0,
            active_connections: 8,
            requests_per_second: 150.0,
            active_release_id: 3,
            version: "0.4.1".into(),
            role: "Edge Node".into(),
        };

        let bytes = payload.to_protobuf_bytes();
        assert!(!bytes.is_empty());
        // Kiểm tra kích thước siêu nhẹ: dưới 100 bytes khi có đủ version và role
        assert!(bytes.len() < 100, "kích thước thực tế: {}", bytes.len());

        // Tag 1 (node_id) bắt đầu bằng (1 << 3) | 2 = 0x0a
        assert_eq!(bytes[0], 0x0a);
        assert_eq!(bytes[1], "node-local-01".len() as u8);
    }

    #[test]
    fn test_prometheus_formatting() {
        record_evaluation(0);
        record_evaluation(1);
        let text = format_prometheus_metrics("test-node-01");
        assert!(
            text.contains(
                "aurora_waf_evaluations_total{action=\"allow\",node_id=\"test-node-01\"}"
            )
        );
        assert!(
            text.contains(
                "aurora_waf_evaluations_total{action=\"block\",node_id=\"test-node-01\"}"
            )
        );
        assert!(text.contains("# TYPE aurora_node_cpu_percent gauge"));
        assert!(!text.contains("} 5.00")); // no fabricated first sample
    }
}
