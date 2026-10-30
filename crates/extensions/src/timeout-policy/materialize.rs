//! Upstream Timeout Policy extension materializer.
//!
//! Configures upstream connection, read, and send timeouts on NGINX proxy passes.

use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if let Some(timeout) = config.get("connect_timeout_ms").and_then(Value::as_u64) {
        server.push_str(&format!("proxy_connect_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    if let Some(timeout) = config.get("read_timeout_ms").and_then(Value::as_u64) {
        server.push_str(&format!("proxy_read_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    if let Some(timeout) = config.get("write_timeout_ms").and_then(Value::as_u64) {
        server.push_str(&format!("proxy_send_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timeout_policy() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "connect_timeout_ms": 5000,
            "read_timeout_ms": 30000
        }"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("proxy_connect_timeout 5000ms;"));
        assert!(server.contains("proxy_read_timeout 30000ms;"));
    }
}
