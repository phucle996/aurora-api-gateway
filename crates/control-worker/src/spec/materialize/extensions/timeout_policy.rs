//! Upstream Timeout Policy extension materializer.

use super::common::unsigned;
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if let Some(timeout) = unsigned(config, "connect_timeout_ms") {
        server.push_str(&format!("proxy_connect_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    if let Some(timeout) = unsigned(config, "read_timeout_ms") {
        server.push_str(&format!("proxy_read_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    if let Some(timeout) = unsigned(config, "write_timeout_ms") {
        server.push_str(&format!("proxy_send_timeout {timeout}ms;\n"));
        *has_server = true;
    }
    Ok(())
}
