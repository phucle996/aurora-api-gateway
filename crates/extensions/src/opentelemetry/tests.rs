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
