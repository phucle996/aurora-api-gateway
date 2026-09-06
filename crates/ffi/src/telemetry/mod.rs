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

#[derive(serde::Deserialize)]
struct DesiredSnapshot<'a> {
    release_id: i64,
    digest: String,
    #[serde(borrow)]
    payload: &'a serde_json::value::RawValue,
}

fn atomic_write_file(path: &str, data: &[u8]) -> std::io::Result<()> {
    if path.is_empty() {
        return Ok(());
    }
    use std::io::Write;
    let tmp_path = format!("{}.tmp.{}", path, std::process::id());
    let mut file = std::fs::File::create(&tmp_path)?;
    file.write_all(data)?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Khởi chạy Background Telemetry Thread (backward compatibility).
pub fn start_telemetry(
    controller_url: &str,
    node_id: &str,
    token: &str,
    interval_seconds: u32,
    active_release_id: i64,
) -> bool {
    start_runtime(
        controller_url,
        node_id,
        token,
        interval_seconds,
        active_release_id,
        "",
        "",
        true,
    )
}

/// Khởi chạy In-Process Native Rust Runtime trong tiến trình NGINX Worker.
pub fn start_runtime(
    controller_url: &str,
    node_id: &str,
    token: &str,
    interval_seconds: u32,
    active_release_id: i64,
    policy_path: &str,
    access_path: &str,
    is_leader: bool,
) -> bool {
    if TELEMETRY_RUNNING.swap(true, Ordering::SeqCst) {
        return true;
    }

    let url = controller_url.to_string();
    let nid = node_id.to_string();
    let tok = token.to_string();
    let interval = if interval_seconds == 0 { 5 } else { interval_seconds };
    let pol_file = policy_path.to_string();
    let acc_file = access_path.to_string();

    let owner = u64::from(std::process::id());
    if is_leader {
        if let Some(slot) = shared_slot(3) {
            slot.store(owner, Ordering::Release);
        }
    }

    let spawn_res = thread::Builder::new()
        .name("aurora-runtime".into())
        .spawn(move || {
            let runtime_started_at = sampler::runtime_started_at();
            let hostname = std::fs::read_to_string("/proc/sys/kernel/hostname")
                .unwrap_or_default()
                .trim()
                .to_string();
            let worker_identity = format!(
                "{}:{}:{}",
                runtime_started_at,
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );

            let mut last_cpu_total = 0u64;
            let mut last_cpu_idle = 0u64;
            let mut last_eval_count = shared_slot(0)
                .unwrap_or(&TOTAL_EVALUATIONS)
                .load(Ordering::Relaxed);
            let mut last_time = Instant::now();

            let mut current_access_release = 0i64;
            let mut current_policy_release = active_release_id;

            let mut last_match_flush = Instant::now();
            let mut last_sync_pull = Instant::now() - Duration::from_secs(10);
            let mut last_heartbeat = Instant::now();

            let initial_delay_secs = if is_leader {
                calculate_initial_stagger(&nid, interval)
            } else {
                0
            };

            while TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                if is_leader
                    && shared_slot(3).is_some_and(|slot| slot.load(Ordering::Acquire) != owner)
                {
                    break;
                }

                let now = Instant::now();

                // 1. DRAIN & FLUSH ACCESS MATCHES (every 500ms)
                if now.duration_since(last_match_flush) >= Duration::from_millis(500) {
                    let matches = crate::access::drain_access_matches(50);
                    if !matches.is_empty() {
                        let endpoint = format!("/api/v1/access-sync/{nid}/matches");
                        for m in matches {
                            let body = format!(
                                r#"{{"key":"{}","release_id":{},"rule_id":{},"ip":"{}"}}"#,
                                m.key, m.release_id, m.rule_id, m.ip
                            );
                            let _ = client::post_json(&url, &endpoint, &tok, &body);
                        }
                    }
                    last_match_flush = now;
                }

                // 2. IN-MEMORY SNAPSHOT RECONCILIATION & HOT-SWAP (every 5s)
                if now.duration_since(last_sync_pull) >= Duration::from_secs(5) {
                    // 2a. Sync Access Ruleset
                    let access_endpoint = format!("/api/v1/access-sync/{nid}");
                    if let Ok(resp_str) = client::get_json(&url, &access_endpoint, &tok)
                        && let Ok(target) = serde_json::from_str::<DesiredSnapshot>(&resp_str)
                    {
                        if target.release_id > 0 && target.release_id != current_access_release {
                            let raw_payload = target.payload.get().as_bytes();
                            let calc_digest = client::sha256_hex(raw_payload);
                            if calc_digest == target.digest {
                                match aurora_engine::access::AccessEngine::from_snapshot(raw_payload) {
                                    Ok(engine) => {
                                        if let Ok(mut g) = crate::access::DYNAMIC_ACCESS_ENGINE.write() {
                                            *g = Some(std::sync::Arc::new(engine));
                                        }
                                        if is_leader && !acc_file.is_empty() {
                                            let _ = atomic_write_file(&acc_file, raw_payload);
                                        }
                                        if is_leader {
                                            let report = format!(
                                                r#"{{"release_id":{},"phase":"observed","message":"In-memory access engine hot-swapped in RAM"}}"#,
                                                target.release_id
                                            );
                                            let _ = client::post_json(&url, &access_endpoint, &tok, &report);
                                        }
                                        current_access_release = target.release_id;
                                    }
                                    Err(err) => {
                                        if is_leader {
                                            let report = format!(
                                                r#"{{"release_id":{},"phase":"failed","message":"Access compilation error: {:?}"}}"#,
                                                target.release_id, err
                                            );
                                            let _ = client::post_json(&url, &access_endpoint, &tok, &report);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2b. Sync Policy Ruleset
                    let policy_endpoint = format!("/api/v1/policy-sync/{nid}");
                    if let Ok(resp_str) = client::get_json(&url, &policy_endpoint, &tok)
                        && let Ok(target) = serde_json::from_str::<DesiredSnapshot>(&resp_str)
                    {
                        if target.release_id > 0 && target.release_id != current_policy_release {
                            let raw_payload = target.payload.get().as_bytes();
                            let calc_digest = client::sha256_hex(raw_payload);
                            if calc_digest == target.digest {
                                match aurora_engine::Engine::from_policy(raw_payload) {
                                    Ok(engine) => {
                                        if let Ok(mut g) = crate::DYNAMIC_POLICY_ENGINE.write() {
                                            *g = Some(std::sync::Arc::new(engine));
                                        }
                                        if is_leader && !pol_file.is_empty() {
                                            let _ = atomic_write_file(&pol_file, raw_payload);
                                        }
                                        if is_leader {
                                            let report = format!(
                                                r#"{{"release_id":{},"phase":"observed","message":"In-memory policy engine hot-swapped in RAM"}}"#,
                                                target.release_id
                                            );
                                            let _ = client::post_json(&url, &policy_endpoint, &tok, &report);
                                        }
                                        current_policy_release = target.release_id;
                                    }
                                    Err(err) => {
                                        if is_leader {
                                            let report = format!(
                                                r#"{{"release_id":{},"phase":"failed","message":"Policy compilation error: {:?}"}}"#,
                                                target.release_id, err
                                            );
                                            let _ = client::post_json(&url, &policy_endpoint, &tok, &report);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    last_sync_pull = now;
                }

                // 3. HEARTBEAT SENDER (only if is_leader, respects interval)
                if is_leader
                    && (now.duration_since(last_heartbeat) >= Duration::from_secs(interval as u64)
                        || (last_heartbeat == now && initial_delay_secs == 0))
                {
                    let elapsed_secs = now.duration_since(last_time).as_secs_f64();
                    let mut cpu = sample_cpu(&mut last_cpu_total, &mut last_cpu_idle);
                    let mut mem = sample_memory();

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

                    let metrics_available = cpu.is_finite() && mem.is_finite();
                    if !metrics_available {
                        cpu = 0.0;
                        mem = 0.0;
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
                        slot.store(
                            if metrics_available { ts as u64 } else { 0 },
                            Ordering::Release,
                        );
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
                                .unwrap_or_default()
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
                        active_release_id: current_policy_release,
                        version: node_version,
                        role: node_role,
                        hostname: hostname.clone(),
                        metrics_scope: sampler::metrics_scope().into(),
                        runtime_started_at,
                        worker_identity: worker_identity.clone(),
                        metrics_available,
                    };

                    let bytes = payload.to_protobuf_bytes();
                    if let Err(err) = post_protobuf(&url, &nid, &tok, &bytes) {
                        eprintln!("[Aurora WAF Telemetry] Warning: post heartbeat failed: {err}");
                    }

                    last_heartbeat = now;
                }

                thread::sleep(Duration::from_millis(250));
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

    if let Some(num) = trailing_num
        && num > 0
    {
        return (num.wrapping_sub(1) * 5) % interval;
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
            ..Default::default()
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
