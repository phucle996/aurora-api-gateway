//! Correlation ID extension materializer.

use crate::materialize::common::{boolean, nginx_header_name, object, string_or};
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if let Some(req_obj) = object(config, "request_id")
        && boolean(req_obj, "enabled").unwrap_or(false)
    {
        let header_name = string_or(req_obj, "header_name", "X-Request-ID");
        let send_in_response = boolean(req_obj, "send_in_response").unwrap_or(true);
        let include_in_access_log = boolean(req_obj, "include_in_access_log").unwrap_or(true);
        let header_directive = nginx_header_name(&header_name)?;

        if include_in_access_log {
            server.push_str("set $aurora_req_id $request_id;\n");
        }
        server.push_str(&format!(
            "proxy_set_header {header_directive} $request_id;\n"
        ));
        if send_in_response {
            server.push_str(&format!(
                "add_header {header_directive} $request_id always;\n"
            ));
        }
        *has_server = true;
    }

    if let Some(trace_obj) = object(config, "trace_id")
        && boolean(trace_obj, "enabled").unwrap_or(false)
    {
        let header_name = string_or(trace_obj, "header_name", "traceparent");
        let send_in_response = boolean(trace_obj, "send_in_response").unwrap_or(false);
        let include_in_access_log = boolean(trace_obj, "include_in_access_log").unwrap_or(true);
        let header_directive = nginx_header_name(&header_name)?;

        server.push_str("set $aurora_span_id 0000000000000000;\n");
        if include_in_access_log {
            server.push_str("set $aurora_trace_id 00-$request_id-$aurora_span_id-01;\n");
        }
        server.push_str(&format!(
            "proxy_set_header {header_directive} \"00-$request_id-$aurora_span_id-01\";\n"
        ));
        if send_in_response {
            server.push_str(&format!(
                "add_header {header_directive} \"00-$request_id-$aurora_span_id-01\" always;\n"
            ));
        }
        *has_server = true;
    }

    Ok(())
}
