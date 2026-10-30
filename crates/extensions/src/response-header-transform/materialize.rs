//! Response Header Transform extension materializer.
//!
//! Injects custom response headers (`add_header`) and hides upstream headers (`proxy_hide_header`).

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
    if let Some(headers) = config.get("add_headers").and_then(Value::as_object) {
        for (name, value) in headers {
            if !is_valid_header_name(name) {
                return Err(format!("header name {name:?} is invalid"));
            }
            let val_str = value
                .as_str()
                .ok_or_else(|| format!("extension header {name} must be a string"))?;
            server.push_str(&format!(
                "add_header {} {} always;\n",
                name,
                nginx_quoted(val_str, "add_headers")?,
            ));
            *has_server = true;
        }
    }
    if let Some(headers) = strings(config, "remove_headers") {
        for name in headers {
            if !is_valid_header_name(&name) {
                return Err(format!("header name {name:?} is invalid"));
            }
            server.push_str(&format!(
                "proxy_hide_header {name};\n"
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
    fn test_response_header_transform() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "add_headers": { "X-Frame-Options": "DENY" },
            "remove_headers": ["Server"]
        }"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("add_header X-Frame-Options \"DENY\" always;"));
        assert!(server.contains("proxy_hide_header Server;"));
    }
}
