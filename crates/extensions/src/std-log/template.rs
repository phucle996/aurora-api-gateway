//! Pre-templated JSON Access Log Byte Blitter.
//!
//! Eliminates runtime reflection, serde AST allocations, and string formatting overhead:
//! static template byte slices are blitted directly with fast integer and escaped string blitters.

use super::task::StdLogTask;

/// Fast branchless and allocation-free integer formatter.
#[inline]
pub fn write_u64(buf: &mut Vec<u8>, mut n: u64) {
    if n == 0 {
        buf.push(b'0');
        return;
    }
    let mut temp = [0u8; 20];
    let mut i = 20;
    while n > 0 {
        i -= 1;
        temp[i] = b'0' + (n % 10) as u8;
        n /= 10;
    }
    buf.extend_from_slice(&temp[i..20]);
}

/// Writes JSON-escaped bytes directly into the output byte buffer.
/// Optimizes common ASCII string cases by blitting unescaped slices via SIMD/memcpy.
#[inline]
pub fn write_escaped_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    let needs_escape = bytes
        .iter()
        .any(|&b| matches!(b, b'"' | b'\\' | b'\n' | b'\r' | b'\t' | 0..=31));
    if !needs_escape {
        buf.extend_from_slice(bytes);
        return;
    }

    const HEX: &[u8; 16] = b"0123456789abcdef";
    for &b in bytes {
        match b {
            b'"' => buf.extend_from_slice(b"\\\""),
            b'\\' => buf.extend_from_slice(b"\\\\"),
            b'\n' => buf.extend_from_slice(b"\\n"),
            b'\r' => buf.extend_from_slice(b"\\r"),
            b'\t' => buf.extend_from_slice(b"\\t"),
            0..=0x1f => {
                buf.extend_from_slice(b"\\u00");
                buf.push(HEX[(b >> 4) as usize]);
                buf.push(HEX[(b & 0xf) as usize]);
            }
            _ => buf.push(b),
        }
    }
}

/// Backwards-compatible string escape wrapper.
#[inline]
pub fn write_escaped_str(buf: &mut Vec<u8>, s: &str) {
    write_escaped_bytes(buf, s.as_bytes());
}

/// Pre-templated JSON Log Formatter.
///
/// Pre-parses and bakes all static JSON structure chunks into static byte arrays.
/// Eliminates runtime reflection, serde AST structures, and intermediate heap allocations.
pub struct FastJsonLogTemplate;

impl FastJsonLogTemplate {
    /// Renders a `StdLogTask` into the provided output buffer as a JSON line (`\n`).
    #[inline]
    pub fn render_to_buf(event: &StdLogTask, out: &mut Vec<u8>) {
        out.extend_from_slice(b"{\"timestamp_unix_nano\":");
        write_u64(out, event.timestamp_unix_nano);

        out.extend_from_slice(b",\"client_ip\":\"");
        write_escaped_bytes(out, event.client_ip_bytes());

        out.extend_from_slice(b"\",\"method\":\"");
        write_escaped_bytes(out, event.method_bytes());

        out.extend_from_slice(b"\",\"uri\":\"");
        write_escaped_bytes(out, event.uri_bytes());

        out.extend_from_slice(b"\",\"status\":");
        write_u64(out, event.status as u64);

        out.extend_from_slice(b",\"duration_ms\":");
        write_u64(out, event.duration_ms as u64);

        out.extend_from_slice(b",\"bytes_sent\":");
        write_u64(out, event.bytes_sent);

        out.extend_from_slice(b",\"bytes_recv\":");
        write_u64(out, event.bytes_recv);

        let host = event.host_bytes();
        if !host.is_empty() {
            out.extend_from_slice(b",\"host\":\"");
            write_escaped_bytes(out, host);
            out.push(b'"');
        }

        let user_agent = event.user_agent_bytes();
        if !user_agent.is_empty() {
            out.extend_from_slice(b",\"user_agent\":\"");
            write_escaped_bytes(out, user_agent);
            out.push(b'"');
        }

        let request_id = event.request_id_bytes();
        if !request_id.is_empty() {
            out.extend_from_slice(b",\"request_id\":\"");
            write_escaped_bytes(out, request_id);
            out.push(b'"');
        }

        let trace_id = event.trace_id_bytes();
        if !trace_id.is_empty() {
            out.extend_from_slice(b",\"trace_id\":\"");
            write_escaped_bytes(out, trace_id);
            out.push(b'"');
        }

        if event.upstream_status > 0 {
            out.extend_from_slice(b",\"upstream_status\":");
            write_u64(out, event.upstream_status as u64);
            out.extend_from_slice(b",\"upstream_response_ms\":");
            write_u64(out, event.upstream_response_ms as u64);
        }

        out.extend_from_slice(b"}\n");
    }
}
