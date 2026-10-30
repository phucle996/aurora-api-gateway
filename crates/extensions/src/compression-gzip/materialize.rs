//! Gzip Compression extension materializer.
//!
//! Emits NGINX gzip compression directives into the server block.

use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    server.push_str("gzip on;\n");
    if let Some(level) = config.get("level").and_then(Value::as_u64) {
        server.push_str(&format!("gzip_comp_level {level};\n"));
    }
    server.push_str("gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n");
    *has_server = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gzip_materialize() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{"level": 6}"#).unwrap();

        materialize(&config, &mut server, &mut has_server).unwrap();
        assert!(has_server);
        assert!(server.contains("gzip on;"));
        assert!(server.contains("gzip_comp_level 6;"));
    }
}
