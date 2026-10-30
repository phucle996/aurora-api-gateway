//! Correlation ID extension materializer.
//!
//! Generates unique request & trace ID headers for upstream propagation and client tracing.

use serde_json::{Map, Value};

#[inline]
fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if let Some(req_obj) = config.get("request_id").and_then(Value::as_object)
        && req_obj.get("enabled").and_then(Value::as_bool).unwrap_or(false)
    {
        let header_name = req_obj.get("header_name").and_then(Value::as_str).unwrap_or("X-Request-ID");
        if !is_valid_header_name(header_name) {
            return Err(format!("header name {header_name:?} is invalid"));
        }
        let send_in_response = req_obj.get("send_in_response").and_then(Value::as_bool).unwrap_or(true);
        let include_in_access_log = req_obj.get("include_in_access_log").and_then(Value::as_bool).unwrap_or(true);

        if include_in_access_log {
            server.push_str("set $aurora_req_id $request_id;\n");
        }
        server.push_str(&format!(
            "proxy_set_header {header_name} $request_id;\n"
        ));
        if send_in_response {
            server.push_str(&format!(
                "add_header {header_name} $request_id always;\n"
            ));
        }
        *has_server = true;
    }

    if let Some(trace_obj) = config.get("trace_id").and_then(Value::as_object)
        && trace_obj.get("enabled").and_then(Value::as_bool).unwrap_or(false)
    {
        let header_name = trace_obj.get("header_name").and_then(Value::as_str).unwrap_or("traceparent");
        if !is_valid_header_name(header_name) {
            return Err(format!("header name {header_name:?} is invalid"));
        }
        let send_in_response = trace_obj.get("send_in_response").and_then(Value::as_bool).unwrap_or(false);
        let include_in_access_log = trace_obj.get("include_in_access_log").and_then(Value::as_bool).unwrap_or(true);

        server.push_str("set $aurora_span_id 0000000000000000;\n");
        if include_in_access_log {
            server.push_str("set $aurora_trace_id 00-$request_id-$aurora_span_id-01;\n");
        }
        server.push_str(&format!(
            "proxy_set_header {header_name} \"00-$request_id-$aurora_span_id-01\";\n"
        ));
        if send_in_response {
            server.push_str(&format!(
                "add_header {header_name} \"00-$request_id-$aurora_span_id-01\" always;\n"
            ));
        }
        *has_server = true;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_correlation_id_materialize() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "request_id": { "enabled": true, "header_name": "X-Req-ID" },
            "trace_id": { "enabled": true }
        }"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("proxy_set_header X-Req-ID $request_id;"));
        assert!(server.contains("add_header X-Req-ID $request_id always;"));
        assert!(server.contains("proxy_set_header traceparent \"00-$request_id-$aurora_span_id-01\";"));
    }
}
