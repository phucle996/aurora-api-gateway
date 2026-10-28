//! Pre-templated JSON Access Log Byte Blitter.
//!
//! Eliminates runtime reflection, serde AST allocations, and string formatting overhead:
//! static template byte slices are blitted directly with fast integer and escaped string blitters.

use super::task::AccessLogTask;

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

/// Writes JSON-escaped string slice directly into the output byte buffer.
#[inline]
pub fn write_escaped_str(buf: &mut Vec<u8>, s: &str) {
    for &b in s.as_bytes() {
        match b {
            b'"' => buf.extend_from_slice(b"\\\""),
            b'\\' => buf.extend_from_slice(b"\\\\"),
            b'\n' => buf.extend_from_slice(b"\\n"),
            b'\r' => buf.extend_from_slice(b"\\r"),
            b'\t' => buf.extend_from_slice(b"\\t"),
            _ => buf.push(b),
        }
    }
}

/// Pre-templated JSON Log Formatter.
///
/// Pre-parses and bakes all static JSON structure chunks into static byte arrays.
/// Eliminates runtime reflection, serde AST structures, and intermediate heap allocations.
pub struct FastJsonLogTemplate;

impl FastJsonLogTemplate {
    /// Renders an `AccessLogTask` into the provided output buffer as a JSON line (`\n`).
    #[inline]
    pub fn render_to_buf(event: &AccessLogTask, out: &mut Vec<u8>) {
        out.extend_from_slice(b"{\"timestamp_unix_nano\":");
        write_u64(out, event.timestamp_unix_nano);

        out.extend_from_slice(b",\"client_ip\":\"");
        write_escaped_str(out, event.client_ip());

        out.extend_from_slice(b"\",\"method\":\"");
        write_escaped_str(out, event.method());

        out.extend_from_slice(b"\",\"uri\":\"");
        write_escaped_str(out, event.uri());

        out.extend_from_slice(b"\",\"status\":");
        write_u64(out, event.status as u64);

        out.extend_from_slice(b",\"duration_ms\":");
        write_u64(out, event.duration_ms as u64);

        out.extend_from_slice(b",\"bytes_sent\":");
        write_u64(out, event.bytes_sent);

        out.extend_from_slice(b",\"bytes_recv\":");
        write_u64(out, event.bytes_recv);

        let host = event.host();
        if !host.is_empty() {
            out.extend_from_slice(b",\"host\":\"");
            write_escaped_str(out, host);
            out.push(b'"');
        }

        let user_agent = event.user_agent();
        if !user_agent.is_empty() {
            out.extend_from_slice(b",\"user_agent\":\"");
            write_escaped_str(out, user_agent);
            out.push(b'"');
        }

        let request_id = event.request_id();
        if !request_id.is_empty() {
            out.extend_from_slice(b",\"request_id\":\"");
            write_escaped_str(out, request_id);
            out.push(b'"');
        }

        let trace_id = event.trace_id();
        if !trace_id.is_empty() {
            out.extend_from_slice(b",\"trace_id\":\"");
            write_escaped_str(out, trace_id);
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
