//! Correlation ID extension materializer.
//!
//! Provides distributed request tracing and unique correlation identifiers across
//! microservices by leveraging NGINX's built-in `$request_id` (128-bit hex string).
//! Supports both standard request tracking headers (e.g. `X-Request-ID`) and W3C
//! Trace Context specifications (`traceparent` in format `00-${request_id}-${span_id}-01`).
//! Identifiers can also be mapped into access log variables `$aurora_req_id` and `$aurora_trace_id`.
//!
//! Generated directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, using `proxy_set_header` to forward IDs upstream and
//! optional `add_header ... always` to echo tracking headers back to client responses with zero downtime.

use crate::spec::materialize::extensions::common::{boolean, nginx_header_name, object, string_or};
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

        if include_in_access_log {
            server.push_str("set $aurora_trace_id $request_id;\n");
        }
        server.push_str(&format!(
            "proxy_set_header {header_directive} \"00-${{request_id}}-${{aurora_span_id}}-01\";\n"
        ));
        if send_in_response {
            server.push_str(&format!(
                "add_header {header_directive} \"00-${{request_id}}-${{aurora_span_id}}-01\" always;\n"
            ));
        }
        *has_server = true;
    }

    Ok(())
}
