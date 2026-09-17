//! Gzip Compression extension materializer.
//!
//! Configures native DEFLATE/Gzip HTTP response compression via NGINX's core `ngx_http_gzip_module`.
//! Dynamically compresses textual responses (JSON, XML, JavaScript, CSS, HTML, SVG) to reduce egress
//! network transfer sizes by up to 70-80% without incurring proxy process memory allocations.
//!
//! Generated directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, taking effect with zero downtime via `aurora-gateway -s reload`.

use crate::spec::materialize::extensions::common::unsigned;
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
