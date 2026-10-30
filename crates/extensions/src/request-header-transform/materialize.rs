//! Request Header Transform extension materializer.
//!
//! Adds, removes, allowlists, or denylists incoming request headers before forwarding to upstreams.

use serde_json::{Map, Value};

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

#[inline]
fn strings(config: &Map<String, Value>, field: &str) -> Option<Vec<String>> {
    config.get(field).and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect()
    })
}

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if !config.get("enabled").and_then(Value::as_bool).unwrap_or(true) {
        return Ok(());
    }

    let mode = config.get("mode").and_then(Value::as_str).unwrap_or("denylist");
    if mode == "allowlist" {
        server.push_str("proxy_pass_request_headers off;\n");
        server.push_str("proxy_set_header Host $host;\n");
        server.push_str("proxy_set_header Content-Type $content_type;\n");
        server.push_str("proxy_set_header Content-Length $content_length;\n");
        if let Some(headers) = strings(config, "allowlist") {
            for name in headers {
                if !is_valid_header_name(&name) {
                    return Err(format!("header name {name:?} is invalid"));
                }
                let variable = format!("$http_{}", name.to_ascii_lowercase().replace('-', "_"));
                server.push_str(&format!(
                    "proxy_set_header {name} {variable};\n"
                ));
            }
        }
        *has_server = true;
    }

    let remove_list = strings(config, "remove_headers").or_else(|| strings(config, "denylist"));
    if let Some(headers) = remove_list {
        for name in headers {
            if !is_valid_header_name(&name) {
                return Err(format!("header name {name:?} is invalid"));
            }
            server.push_str(&format!("proxy_set_header {name} \"\";\n"));
            *has_server = true;
        }
    }

    if let Some(headers) = config.get("add_headers").and_then(Value::as_object) {
        for (name, value) in headers {
            if !is_valid_header_name(name) {
                return Err(format!("header name {name:?} is invalid"));
            }
            let val_str = value
                .as_str()
                .ok_or_else(|| format!("extension header {name} must be a string"))?;
            server.push_str(&format!(
                "proxy_set_header {} {};\n",
                name,
                nginx_quoted(val_str, "add_headers")?,
            ));
            *has_server = true;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_header_transform() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "remove_headers": ["X-Forwarded-Secret"],
            "add_headers": { "X-Gateway": "Aurora" }
        }"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("proxy_set_header X-Forwarded-Secret \"\";"));
        assert!(server.contains("proxy_set_header X-Gateway \"Aurora\";"));
    }
}
