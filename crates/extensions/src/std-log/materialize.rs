//! Standard Stream & Structured Log (`builtin/std-log`) Materializer.
//!
//! Emits the declarative `gateway_std_log on | off | <path>;` directive into
//! the NGINX server configuration block, eliminating NGINX's native `access_log`.

use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    let enabled = config.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    if enabled {
        server.push_str("    gateway_std_log on;\n");
        *has_server = true;
    } else {
        server.push_str("    gateway_std_log off;\n");
        *has_server = true;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_std_log_materialize() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{"enabled": true}"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("gateway_std_log on;"));
    }
}
