//! Maintenance Mode extension materializer.
//!
//! Returns planned maintenance responses (e.g. 503 Service Unavailable) with optional bypass headers.

use serde_json::{Map, Value, json};

#[inline]
fn is_valid_header_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[inline]
fn nginx_quoted(value: &str, field: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(format!("{field} contains a prohibited control character"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    let message = config.get("message").and_then(Value::as_str).unwrap_or("Service undergoing planned maintenance.");
    let body = serde_json::to_string(&json!({ "error": message }))
        .map_err(|error| format!("encode maintenance response: {error}"))?;
    let retry_after = config.get("retry_after_secs").and_then(Value::as_u64).unwrap_or(300);
    let status_code = config.get("status_code").and_then(Value::as_u64).unwrap_or(503);

    server.push_str(&format!("add_header Retry-After {retry_after} always;\n"));
    if let Some(bypass_header) = config.get("bypass_header").and_then(Value::as_str) {
        if !is_valid_header_name(bypass_header) {
            return Err(format!("header name {bypass_header:?} is invalid"));
        }
        let variable = format!("$http_{}", bypass_header.to_ascii_lowercase().replace('-', "_"));
        server.push_str("set $aurora_maintenance 1;\n");
        server.push_str(&format!(
            "if ({variable}) {{\n    set $aurora_maintenance 0;\n}}\n"
        ));
        server.push_str(&format!(
            "if ($aurora_maintenance = 1) {{\n    return {status_code} {};\n}}\n",
            nginx_quoted(&body, "message")?
        ));
    } else {
        server.push_str(&format!(
            "return {status_code} {};\n",
            nginx_quoted(&body, "message")?
        ));
    }
    *has_server = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_maintenance_materialize() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "status_code": 503,
            "bypass_header": "X-Bypass"
        }"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("add_header Retry-After 300 always;"));
        assert!(server.contains("if ($http_x_bypass) {\n    set $aurora_maintenance 0;\n}"));
    }
}
