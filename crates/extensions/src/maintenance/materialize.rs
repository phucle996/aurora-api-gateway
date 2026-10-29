//! Maintenance Mode extension materializer.

use crate::materialize::common::{
    nginx_quoted, nginx_request_header_variable, string, string_or, unsigned_or,
};
use serde_json::{Map, Value, json};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    let message = string_or(config, "message", "Service undergoing planned maintenance.");
    let body = serde_json::to_string(&json!({ "error": message }))
        .map_err(|error| format!("encode maintenance response: {error}"))?;
    server.push_str(&format!(
        "add_header Retry-After {} always;\n",
        unsigned_or(config, "retry_after_secs", 300)
    ));
    if let Some(bypass_header) = string(config, "bypass_header") {
        let variable = nginx_request_header_variable(bypass_header)?;
        server.push_str("set $aurora_maintenance 1;\n");
        server.push_str(&format!(
            "if ({variable}) {{\n    set $aurora_maintenance 0;\n}}\n"
        ));
        server.push_str(&format!(
            "if ($aurora_maintenance = 1) {{\n    return {} {};\n}}\n",
            unsigned_or(config, "status_code", 503),
            nginx_quoted(&body, "message")?
        ));
    } else {
        server.push_str(&format!(
            "return {} {};\n",
            unsigned_or(config, "status_code", 503),
            nginx_quoted(&body, "message")?
        ));
    }
    *has_server = true;
    Ok(())
}
