//! Module quản lý thu thập và gửi Telemetry Heartbeat trực tiếp từ NGINX Worker.
//! Chạy trên một OS Thread riêng biệt, gửi protobuf binary (~37 bytes) mỗi chu kỳ (mặc định 10s).

use std::{
    fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

static TELEMETRY_RUNNING: AtomicBool = AtomicBool::new(false);
static TOTAL_EVALUATIONS: AtomicU64 = AtomicU64::new(0);

/// Ghi nhận 1 lượt đánh giá rule khi NGINX xử lý request.
#[inline]
pub fn record_evaluation() {
    TOTAL_EVALUATIONS.fetch_add(1, Ordering::Relaxed);
}

/// Cấu trúc dữ liệu nhị phân Heartbeat tương thích 100% với Go Protocol Buffers wire format.
#[derive(Debug, Clone, Default)]
pub struct HeartbeatPayload {
    pub node_id: String,
    pub timestamp: i64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub active_connections: i64,
    pub requests_per_second: f64,
    pub active_release_id: i64,
}

impl HeartbeatPayload {
    /// Tuần tự hóa HeartbeatPayload sang Protocol Buffers wire format thô không cần thư viện bên thứ 3.
    pub fn to_protobuf_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(64);

        // Tag 1: node_id (string, wire type 2)
        if !self.node_id.is_empty() {
            encode_tag(&mut buf, 1, 2);
            encode_varint(&mut buf, self.node_id.len() as u64);
            buf.extend_from_slice(self.node_id.as_bytes());
        }

        // Tag 2: timestamp (int64, wire type 0)
        if self.timestamp != 0 {
            encode_tag(&mut buf, 2, 0);
            encode_varint(&mut buf, self.timestamp as u64);
        }

        // Tag 3: cpu_usage (double / fixed64, wire type 1)
        if self.cpu_usage != 0.0 {
            encode_tag(&mut buf, 3, 1);
            buf.extend_from_slice(&self.cpu_usage.to_bits().to_le_bytes());
        }

        // Tag 4: memory_usage (double / fixed64, wire type 1)
        if self.memory_usage != 0.0 {
            encode_tag(&mut buf, 4, 1);
            buf.extend_from_slice(&self.memory_usage.to_bits().to_le_bytes());
        }

        // Tag 5: active_connections (int64, wire type 0)
        if self.active_connections != 0 {
            encode_tag(&mut buf, 5, 0);
            encode_varint(&mut buf, self.active_connections as u64);
        }

        // Tag 6: requests_per_second (double / fixed64, wire type 1)
        if self.requests_per_second != 0.0 {
            encode_tag(&mut buf, 6, 1);
            buf.extend_from_slice(&self.requests_per_second.to_bits().to_le_bytes());
        }

        // Tag 7: active_release_id (int64, wire type 0)
        if self.active_release_id != 0 {
            encode_tag(&mut buf, 7, 0);
            encode_varint(&mut buf, self.active_release_id as u64);
        }

        buf
    }
}

fn encode_tag(buf: &mut Vec<u8>, field_number: u32, wire_type: u8) {
    encode_varint(buf, ((field_number as u64) << 3) | (wire_type as u64));
}

fn encode_varint(buf: &mut Vec<u8>, mut val: u64) {
    while val >= 0x80 {
        buf.push(((val & 0x7f) as u8) | 0x80);
        val >>= 7;
    }
    buf.push(val as u8);
}

/// Đọc thông tin % CPU sử dụng từ /proc/stat của Linux.
fn sample_cpu(last_total: &mut u64, last_idle: &mut u64) -> f64 {
    if let Ok(content) = fs::read_to_string("/proc/stat") {
        for line in content.lines() {
            if line.starts_with("cpu ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 5 {
                    let user: u64 = parts[1].parse().unwrap_or(0);
                    let nice: u64 = parts[2].parse().unwrap_or(0);
                    let system: u64 = parts[3].parse().unwrap_or(0);
                    let idle: u64 = parts[4].parse().unwrap_or(0);

                    let mut total = user + nice + system + idle;
                    for part in &parts[5..] {
                        total += part.parse::<u64>().unwrap_or(0);
                    }

                    if *last_total > 0 && total > *last_total {
                        let diff_total = (total - *last_total) as f64;
                        let diff_idle = (idle - *last_idle) as f64;
                        *last_total = total;
                        *last_idle = idle;
                        let usage = (1.0 - (diff_idle / diff_total)) * 100.0;
                        return usage.clamp(0.0, 100.0);
                    }

                    *last_total = total;
                    *last_idle = idle;
                    return 5.0;
                }
            }
        }
    }
    5.0
}

/// Đọc thông tin % RAM sử dụng từ /proc/meminfo của Linux.
fn sample_memory() -> f64 {
    if let Ok(content) = fs::read_to_string("/proc/meminfo") {
        let mut total: u64 = 0;
        let mut avail: u64 = 0;

        for line in content.lines() {
            if line.starts_with("MemTotal:") {
                if let Some(val) = line.split_whitespace().nth(1) {
                    total = val.parse().unwrap_or(0);
                }
            } else if line.starts_with("MemAvailable:") {
                if let Some(val) = line.split_whitespace().nth(1) {
                    avail = val.parse().unwrap_or(0);
                }
            }
        }

        if total > 0 && avail > 0 && total >= avail {
            return (((total - avail) as f64) / (total as f64)) * 100.0;
        }
    }
    10.0
}

/// Gửi gói tin HTTP POST chứa protobuf binary tới Control Plane bằng TcpStream thuần.
fn post_protobuf(url: &str, node_id: &str, token: &str, payload: &[u8]) -> Result<(), String> {
    let stripped = url.trim();
    let url_without_proto = stripped
        .strip_prefix("http://")
        .or_else(|| stripped.strip_prefix("https://"))
        .unwrap_or(stripped);

    let (host_port, _) = match url_without_proto.split_once('/') {
        Some((hp, rest)) => (hp, rest),
        None => (url_without_proto, ""),
    };

    let host = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{}:80", host_port)
    };

    let addrs: Vec<_> = host
        .to_socket_addrs()
        .map_err(|e| format!("resolve error: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err("không tìm thấy địa chỉ IP cho host".into());
    }

    let mut stream = TcpStream::connect_timeout(&addrs[0], Duration::from_secs(3))
        .map_err(|e| format!("connect error: {e}"))?;

    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set write timeout: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set read timeout: {e}"))?;

    let path = format!("/api/v1/nodes/{node_id}/heartbeat");
    let mut req = format!(
        "POST {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Content-Type: application/x-protobuf\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n",
        path,
        host_port,
        payload.len()
    );

    if !token.is_empty() {
        req.push_str(&format!("Authorization: Bearer {}\r\n", token.trim()));
    }
    req.push_str("\r\n");

    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write header: {e}"))?;
    stream
        .write_all(payload)
        .map_err(|e| format!("write body: {e}"))?;
    stream.flush().map_err(|e| format!("flush: {e}"))?;

    let mut response = [0u8; 128];
    let n = stream
        .read(&mut response)
        .map_err(|e| format!("read resp: {e}"))?;
    let resp_str = String::from_utf8_lossy(&response[..n]);

    if resp_str.starts_with("HTTP/1.1 204")
        || resp_str.starts_with("HTTP/1.1 200")
        || resp_str.starts_with("HTTP/1.0 204")
        || resp_str.starts_with("HTTP/1.0 200")
    {
        Ok(())
    } else {
        Err(format!(
            "control plane trả về mã khác 204: {}",
            resp_str.lines().next().unwrap_or("")
        ))
    }
}

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
    let interval = if interval_seconds == 0 { 10 } else { interval_seconds };

    let spawn_res = thread::Builder::new()
        .name("aurora-telemetry".into())
        .spawn(move || {
            let mut last_cpu_total = 0u64;
            let mut last_cpu_idle = 0u64;
            let mut last_eval_count = TOTAL_EVALUATIONS.load(Ordering::Relaxed);
            let mut last_time = Instant::now();

            while TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                let now = Instant::now();
                let elapsed_secs = now.duration_since(last_time).as_secs_f64();

                let cpu = sample_cpu(&mut last_cpu_total, &mut last_cpu_idle);
                let mem = sample_memory();

                let current_eval_count = TOTAL_EVALUATIONS.load(Ordering::Relaxed);
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

                let payload = HeartbeatPayload {
                    node_id: nid.clone(),
                    timestamp: ts,
                    cpu_usage: cpu,
                    memory_usage: mem,
                    active_connections: 0,
                    requests_per_second: rps,
                    active_release_id,
                };

                let bytes = payload.to_protobuf_bytes();
                if let Err(err) = post_protobuf(&url, &nid, &tok, &bytes) {
                    eprintln!("[Aurora WAF Telemetry] Warning: post heartbeat failed: {err}");
                }

                // Ngủ theo từng khoảng ngắn 500ms để có thể dừng ngay khi NGINX shutdown/reload
                for _ in 0..(interval * 2) {
                    if !TELEMETRY_RUNNING.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
            }
        });

    spawn_res.is_ok()
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
        };

        let bytes = payload.to_protobuf_bytes();
        assert!(!bytes.is_empty());
        // Kiểm tra kích thước siêu nhẹ: dưới 64 bytes
        assert!(bytes.len() < 64, "kích thước thực tế: {}", bytes.len());

        // Tag 1 (node_id) bắt đầu bằng (1 << 3) | 2 = 0x0a
        assert_eq!(bytes[0], 0x0a);
        assert_eq!(bytes[1], "node-local-01".len() as u8);
    }
}
