use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Gửi gói tin HTTP POST chứa protobuf binary tới Control Plane bằng TcpStream thuần.
pub fn post_protobuf(url: &str, node_id: &str, token: &str, payload: &[u8]) -> Result<(), String> {
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

    let mut response = [0u8; 1024];
    let n = stream
        .read(&mut response)
        .map_err(|e| format!("read resp: {e}"))?;
    let resp_str = String::from_utf8_lossy(&response[..n]);

    if resp_str.starts_with("HTTP/1.1 204")
        || resp_str.starts_with("HTTP/1.1 200")
        || resp_str.starts_with("HTTP/1.0 204")
        || resp_str.starts_with("HTTP/1.0 200")
    {
        // Phân tích chỉ thị lệnh (Directive) từ body nếu có
        if let Some((_header, body)) = resp_str.split_once("\r\n\r\n")
            && (body.contains("\"action\":\"reload_process\"")
                || body.contains("\"action\": \"reload_process\""))
        {
            unsafe extern "C" {
                fn getppid() -> i32;
                fn kill(pid: i32, sig: i32) -> i32;
            }
            const SIGHUP: i32 = 1;

            let ppid = unsafe { getppid() };
            if ppid > 1 {
                eprintln!(
                    "[Aurora WAF Telemetry] Nhận lệnh reload_process từ Control Plane. Gửi SIGHUP tới Master PID {ppid}"
                );
                let ret = unsafe { kill(ppid, SIGHUP) };
                if ret != 0 {
                    let err = std::io::Error::last_os_error();
                    eprintln!(
                        "[Aurora WAF Telemetry] Cảnh báo: Gửi SIGHUP tới Master PID {ppid} thất bại: {err}"
                    );
                }
            }
        }
        Ok(())
    } else {
        Err(format!(
            "control plane trả về mã lỗi: {}",
            resp_str.lines().next().unwrap_or("")
        ))
    }
}
