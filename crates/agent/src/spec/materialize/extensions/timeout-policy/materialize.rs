//! Upstream Timeout Policy extension materializer.
//!
//! Configures fine-grained network timeout thresholds for proxy upstream communication,
//! including TCP connection establishment (`proxy_connect_timeout`), upstream read silence gaps
//! (`proxy_read_timeout`), and upstream write silence gaps (`proxy_send_timeout`). This protects
//! the gateway against hanging upstream connections and cascading worker pool exhaustion.
//!
//! Directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, taking effect with zero downtime via `aurora-gateway -s reload`.

use crate::spec::materialize::extensions::common::unsigned;
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
