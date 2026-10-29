use super::*;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct SharedBufferWriter(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for SharedBufferWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn test_fast_json_log_template_rendering() {
    let slices = StdLogSlices {
        client_ip: b"192.168.1.100",
        method: b"POST",
        uri: b"/api/v1/orders?item=book&qty=2",
        host: b"api.example.com",
        user_agent: b"curl/8.5.0",
        request_id: b"req-abc-123",
        trace_id: b"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    };

    let meta = StdLogMetadata {
        status: 201,
        duration_ms: 12,
        bytes_sent: 1024,
        bytes_recv: 256,
        upstream_status: 201,
        upstream_response_ms: 10,
        timestamp_unix_nano: 1729000000000000000,
    };

    let task = StdLogTask::from_slices(slices, meta);
    let mut out = Vec::new();
    FastJsonLogTemplate::render_to_buf(&task, &mut out);

    let rendered = String::from_utf8(out).expect("rendered JSON must be valid UTF-8");
    assert!(rendered.ends_with('\n'), "log line must end with newline");
    assert!(rendered.contains("\"timestamp_unix_nano\":1729000000000000000"));
    assert!(rendered.contains("\"client_ip\":\"192.168.1.100\""));
    assert!(rendered.contains("\"method\":\"POST\""));
    assert!(rendered.contains("\"uri\":\"/api/v1/orders?item=book&qty=2\""));
    assert!(rendered.contains("\"status\":201"));
    assert!(rendered.contains("\"duration_ms\":12"));
    assert!(rendered.contains("\"bytes_sent\":1024"));
    assert!(rendered.contains("\"bytes_recv\":256"));
    assert!(rendered.contains("\"host\":\"api.example.com\""));
    assert!(rendered.contains("\"user_agent\":\"curl/8.5.0\""));
    assert!(rendered.contains("\"request_id\":\"req-abc-123\""));
    assert!(rendered.contains("\"trace_id\":\"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\""));
    assert!(rendered.contains("\"upstream_status\":201"));
    assert!(rendered.contains("\"upstream_response_ms\":10"));
}

#[test]
fn test_inline_buffer_stack_vs_spill() {
    // 1. Within INLINE_CAPACITY (256 bytes) -> stays inline on the stack
    let short_slices = StdLogSlices {
        client_ip: b"127.0.0.1",
        method: b"GET",
        uri: b"/healthz",
        host: b"localhost",
        user_agent: b"test",
        request_id: b"r1",
        trace_id: b"t1",
    };
    let meta = StdLogMetadata::default();
    let short_task = StdLogTask::from_slices(short_slices, meta);
    assert_eq!(short_task.client_ip(), "127.0.0.1");
    assert_eq!(short_task.uri(), "/healthz");
    match &short_task.buffer {
        InlineStrBuffer::Inline { len, .. } => assert_eq!(*len as usize, short_task.buffer.len()),
        InlineStrBuffer::Spilled(_) => panic!("expected inline buffer"),
    }

    // 2. Over INLINE_CAPACITY (256 bytes) -> spills gracefully to heap without crashing
    let long_uri = vec![b'a'; 500];
    let long_slices = StdLogSlices {
        client_ip: b"10.0.0.1",
        method: b"GET",
        uri: &long_uri,
        host: b"example.org",
        user_agent: b"bench",
        request_id: b"r2",
        trace_id: b"t2",
    };
    let long_task = StdLogTask::from_slices(long_slices, meta);
    assert_eq!(long_task.client_ip(), "10.0.0.1");
    assert_eq!(long_task.uri().len(), 500);
    match &long_task.buffer {
        InlineStrBuffer::Spilled(v) => assert_eq!(v.len(), long_task.buffer.len()),
        InlineStrBuffer::Inline { .. } => panic!("expected spilled buffer"),
    }
}

#[test]
fn test_std_log_plugin_batching_and_flush() {
    let shared = SharedBufferWriter::default();
    let mut plugin = StdLogPlugin::new(shared.clone(), 3);

    let slices = StdLogSlices {
        client_ip: b"1.2.3.4",
        method: b"GET",
        uri: b"/ping",
        host: b"",
        user_agent: b"",
        request_id: b"",
        trace_id: b"",
    };
    let meta = StdLogMetadata::default();
    let task = StdLogTask::from_slices(slices, meta);

    // Push 2 items: below batch threshold (3) -> nothing flushed yet
    plugin.handle_task(&task);
    plugin.handle_task(&task);
    assert_eq!(shared.0.lock().unwrap().len(), 0);

    // Push 3rd item: threshold reached -> automatic batch flush
    plugin.handle_task(&task);
    let flushed_len = shared.0.lock().unwrap().len();
    assert!(flushed_len > 0);

    // Manual flush or tick flushes remaining items
    plugin.handle_task(&task);
    plugin.flush();
    assert!(shared.0.lock().unwrap().len() > flushed_len);
}

#[test]
fn test_write_u64_and_escaped_str() {
    let mut buf = Vec::new();
    write_u64(&mut buf, 0);
    assert_eq!(buf, b"0");

    buf.clear();
    write_u64(&mut buf, 1234567890);
    assert_eq!(buf, b"1234567890");

    buf.clear();
    write_escaped_str(&mut buf, "hello \"world\"\n\r\t\\");
    assert_eq!(buf, b"hello \\\"world\\\"\\n\\r\\t\\\\");

    buf.clear();
    write_escaped_bytes(&mut buf, b"clean-ascii-path");
    assert_eq!(buf, b"clean-ascii-path");

    buf.clear();
    write_escaped_bytes(&mut buf, b"null\x00bell\x07backspace\x08unit_sep\x1f");
    assert_eq!(buf, b"null\\u0000bell\\u0007backspace\\u0008unit_sep\\u001f");
}

#[test]
fn test_std_log_task_large_payload_no_truncation() {
    let large_uri = vec![b'a'; 70000];
    let slices = StdLogSlices {
        client_ip: b"127.0.0.1",
        method: b"GET",
        uri: &large_uri,
        host: b"localhost",
        user_agent: b"test-agent",
        request_id: b"req-1",
        trace_id: b"trace-1",
    };

    let meta = StdLogMetadata {
        status: 200,
        duration_ms: 1,
        bytes_sent: 0,
        bytes_recv: 0,
        upstream_status: 0,
        upstream_response_ms: 0,
        timestamp_unix_nano: 1000,
    };

    let task = StdLogTask::from_slices(slices, meta);
    assert_eq!(task.client_ip(), "127.0.0.1");
    assert_eq!(task.method(), "GET");
    // With u32 ranges, large payloads (> 64KB) are fully preserved without any artificial truncation
    let uri_bytes = task.uri_bytes();
    assert_eq!(uri_bytes.len(), 70000);
    assert!(uri_bytes.iter().all(|&b| b == b'a'));

    // All subsequent fields are also completely intact
    assert_eq!(task.host_bytes(), b"localhost");
    assert_eq!(task.user_agent_bytes(), b"test-agent");
    assert_eq!(task.request_id_bytes(), b"req-1");
    assert_eq!(task.trace_id_bytes(), b"trace-1");
}

#[test]
fn test_std_log_task_from_raw() {
    let ip = b"10.244.0.15";
    let method = b"GET";
    let uri = b"/api/v1/health";
    let host = b"gateway.internal";
    let ua = b"wrk/4.2.0";

    let raw = AuroraLogInput {
        client_ip: ip.as_ptr(),
        client_ip_len: ip.len(),
        method: method.as_ptr(),
        method_len: method.len(),
        uri: uri.as_ptr(),
        uri_len: uri.len(),
        host: host.as_ptr(),
        host_len: host.len(),
        user_agent: ua.as_ptr(),
        user_agent_len: ua.len(),
        request_id: std::ptr::null(),
        request_id_len: 0,
        trace_id: std::ptr::null(),
        trace_id_len: 0,
        status: 200,
        duration_ms: 5,
        bytes_sent: 120,
        bytes_recv: 80,
        upstream_status: 200,
        upstream_response_ms: 4,
        upstream_connect_ms: 1,
        is_ssl: 0,
        ssl_reused: 0,
        is_matched: 1,
        active_conns: 10,
        reading_conns: 1,
        writing_conns: 2,
        waiting_conns: 7,
        timestamp_unix_nano: 1729000000123456789,
    };

    let task = StdLogTask::from_raw(&raw);
    assert_eq!(task.client_ip(), "10.244.0.15");
    assert_eq!(task.method(), "GET");
    assert_eq!(task.uri(), "/api/v1/health");
    assert_eq!(task.host(), "gateway.internal");
    assert_eq!(task.user_agent(), "wrk/4.2.0");
    assert_eq!(task.status, 200);
    assert_eq!(task.duration_ms, 5);
    assert_eq!(task.timestamp_unix_nano, 1729000000123456789);
}
