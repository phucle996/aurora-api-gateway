use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Tính toán mã băm SHA-256 thuần Rust (zero dependency) trả về chuỗi hex viết thường.
pub fn sha256_hex(data: &[u8]) -> String {
    let hash = sha256_digest(data);
    let mut out = String::with_capacity(64);
    for b in hash {
        use std::fmt::Write;
        let _ = write!(out, "{:02x}", b);
    }
    out
}

fn sha256_digest(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[4 * i],
                chunk[4 * i + 1],
                chunk[4 * i + 2],
                chunk[4 * i + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, val) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&val.to_be_bytes());
    }
    out
}

fn connect_http(url: &str) -> Result<(TcpStream, String), String> {
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
        .map_err(|e| format!("resolve error {host}: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err("không tìm thấy địa chỉ IP cho host".into());
    }

    let stream = TcpStream::connect_timeout(&addrs[0], Duration::from_secs(3))
        .map_err(|e| format!("connect error {host}: {e}"))?;

    stream
        .set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set write timeout: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| format!("set read timeout: {e}"))?;

    Ok((stream, host_port.to_string()))
}

/// Gửi gói tin HTTP POST chứa protobuf binary tới Control Plane bằng TcpStream thuần.
pub fn post_protobuf(url: &str, node_id: &str, token: &str, payload: &[u8]) -> Result<(), String> {
    let (mut stream, host_port) = connect_http(url)?;
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

/// Thực hiện HTTP GET tới endpoint JSON của Control Plane.
pub fn get_json(url: &str, path: &str, token: &str) -> Result<String, String> {
    let (mut stream, host_port) = connect_http(url)?;
    let mut req = format!(
        "GET {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Accept: application/json\r\n\
         Connection: close\r\n",
        path, host_port
    );
    if !token.is_empty() {
        req.push_str(&format!("Authorization: Bearer {}\r\n", token.trim()));
    }
    req.push_str("\r\n");

    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write get req: {e}"))?;
    stream.flush().map_err(|e| format!("flush get req: {e}"))?;

    let mut buf = Vec::with_capacity(16384);
    let mut chunk = [0u8; 8192];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > 131072 {
                    return Err("response exceeds 128KB limit".into());
                }
            }
            Err(e) => return Err(format!("read error: {e}")),
        }
    }

    let resp_str = String::from_utf8_lossy(&buf);
    let status_line = resp_str.lines().next().unwrap_or("");
    if !status_line.starts_with("HTTP/1.1 200") && !status_line.starts_with("HTTP/1.0 200") {
        return Err(format!("HTTP error status: {status_line}"));
    }

    let body_bytes = if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
        &buf[pos + 4..]
    } else if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
        &buf[pos + 2..]
    } else {
        return Err("malformed HTTP response: missing headers delimiter".into());
    };

    // Kiểm tra nếu response dùng Transfer-Encoding: chunked
    if resp_str
        .split("\r\n\r\n")
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked(body_bytes)
    } else {
        String::from_utf8(body_bytes.to_vec()).map_err(|e| format!("invalid utf-8 body: {e}"))
    }
}

/// Thực hiện HTTP POST gửi payload JSON tới Control Plane và trả về HTTP status code.
pub fn post_json(url: &str, path: &str, token: &str, payload: &str) -> Result<u16, String> {
    let (mut stream, host_port) = connect_http(url)?;
    let mut req = format!(
        "POST {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Content-Type: application/json\r\n\
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
        .map_err(|e| format!("write post header: {e}"))?;
    stream
        .write_all(payload.as_bytes())
        .map_err(|e| format!("write post body: {e}"))?;
    stream.flush().map_err(|e| format!("flush post: {e}"))?;

    let mut response = [0u8; 1024];
    let n = stream
        .read(&mut response)
        .map_err(|e| format!("read post resp: {e}"))?;
    let resp_str = String::from_utf8_lossy(&response[..n]);
    let status_line = resp_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = status_line.split_whitespace().collect();
    if parts.len() >= 2
        && let Ok(code) = parts[1].parse::<u16>()
    {
        return Ok(code);
    }
    Err(format!("invalid status line: {status_line}"))
}

fn decode_chunked(body: &[u8]) -> Result<String, String> {
    let mut cursor = 0;
    let mut out = Vec::new();
    while cursor < body.len() {
        let chunk_slice = &body[cursor..];
        let nl = chunk_slice
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("invalid chunked framing")?;
        let len_str = std::str::from_utf8(&chunk_slice[..nl])
            .map_err(|e| e.to_string())?
            .trim();
        let chunk_len =
            usize::from_str_radix(len_str, 16).map_err(|e| format!("chunk len err: {e}"))?;
        if chunk_len == 0 {
            break;
        }
        let data_start = cursor + nl + 2;
        let data_end = data_start + chunk_len;
        if data_end > body.len() {
            return Err("truncated chunked body".into());
        }
        out.extend_from_slice(&body[data_start..data_end]);
        cursor = data_end + 2; // skip trailing \r\n
    }
    String::from_utf8(out).map_err(|e| format!("invalid utf-8 chunked body: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            sha256_hex(b"The quick brown fox jumps over the lazy dog"),
            "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
        );
    }
}
