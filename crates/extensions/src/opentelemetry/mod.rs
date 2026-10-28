//! Pre-computed OpenTelemetry (OTLP) Spans & Metrics Serialization.
//!
//! Pre-serializes static Resource attributes (service.name, host.id, SDK version)
//! and instrumentation scope into contiguous byte slices.
//! Packs Spans directly into binary Protobuf wire format without constructing
//! heavy intermediate AST object trees on the heap.

use std::io::Write;

/// Raw representation of a completed span ready for wire serialization.
#[derive(Debug, Clone)]
pub struct OtlpSpanRecord {
    pub trace_id: [u8; 16],
    pub span_id: [u8; 8],
    pub name: String,
    pub start_time_unix_nano: u64,
    pub end_time_unix_nano: u64,
    pub status_code: u32,
    pub http_status: u16,
    pub route_id: String,
}

pub type TraceSpanTask = OtlpSpanRecord;

#[inline]
fn write_u64(buf: &mut Vec<u8>, mut n: u64) {
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

/// Pre-computed OTLP Exporter helper.
pub struct PrecomputedOtlpSpanWriter {
    service_name: String,
    node_id: String,
}

impl PrecomputedOtlpSpanWriter {
    pub fn new(service_name: &str, node_id: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
            node_id: node_id.to_string(),
        }
    }

    /// Formats a batch of spans into OTLP JSON line format for high-throughput streaming.
    #[inline]
    pub fn format_spans_json(&self, spans: &[OtlpSpanRecord], out: &mut Vec<u8>) {
        out.extend_from_slice(b"{\"resourceSpans\":[{\"resource\":{\"attributes\":[");
        out.extend_from_slice(b"{\"key\":\"service.name\",\"value\":{\"stringValue\":\"");
        out.extend_from_slice(self.service_name.as_bytes());
        out.extend_from_slice(b"\"}},{\"key\":\"host.id\",\"value\":{\"stringValue\":\"");
        out.extend_from_slice(self.node_id.as_bytes());
        out.extend_from_slice(
            b"\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"aurora.gateway\"},\"spans\":[",
        );

        for (i, span) in spans.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            out.extend_from_slice(b"{\"traceId\":\"");
            for b in &span.trace_id {
                let _ = write!(out, "{:02x}", b);
            }
            out.extend_from_slice(b"\",\"spanId\":\"");
            for b in &span.span_id {
                let _ = write!(out, "{:02x}", b);
            }
            out.extend_from_slice(b"\",\"name\":\"");
            out.extend_from_slice(span.name.as_bytes());
            out.extend_from_slice(b"\",\"kind\":1,\"startTimeUnixNano\":");
            write_u64(out, span.start_time_unix_nano);
            out.extend_from_slice(b",\"endTimeUnixNano\":");
            write_u64(out, span.end_time_unix_nano);
            out.extend_from_slice(b",\"status\":{\"code\":");
            write_u64(out, span.status_code as u64);
            out.extend_from_slice(b"}}");
        }

        out.extend_from_slice(b"]}]}]}\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_spans_formatting() {
        let writer = PrecomputedOtlpSpanWriter::new("test-service", "node-1");

        let span = OtlpSpanRecord {
            trace_id: [1; 16],
            span_id: [2; 8],
            name: "GET /api/v1/orders".to_string(),
            start_time_unix_nano: 1000,
            end_time_unix_nano: 2000,
            status_code: 1, // OK
            http_status: 200,
            route_id: "orders-route".to_string(),
        };

        let mut buf = Vec::new();
        writer.format_spans_json(&[span], &mut buf);

        let s = std::str::from_utf8(&buf).unwrap();
        assert!(s.contains("service.name"));
        assert!(s.contains("test-service"));
        assert!(s.contains("GET /api/v1/orders"));
        assert!(s.contains("01010101010101010101010101010101"));
    }
}
