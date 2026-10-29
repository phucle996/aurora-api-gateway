//! Gzip Compression extension materializer.

use crate::materialize::common::unsigned;
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    server.push_str("gzip on;\n");
    if let Some(level) = unsigned(config, "level") {
        server.push_str(&format!("gzip_comp_level {level};\n"));
    }
    server.push_str("gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n");
    *has_server = true;
    Ok(())
}
