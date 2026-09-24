//! Cross-Origin Resource Sharing (CORS) extension materializer.
//!
//! Implements native W3C CORS handling at the edge proxy layer. Intercepts HTTP `OPTIONS`
//! preflight requests directly within NGINX and returns `204 No Content` with appropriate
//! CORS headers without forwarding requests to backend upstreams, eliminating roundtrip latency.
//! Attaches `Access-Control-Allow-*` response headers with the `always` directive to guarantee
//! header preservation across both successful and error responses.
//!
//! Generated directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, taking effect with zero downtime via `aurora-gateway -s reload`.

use crate::spec::materialize::extensions::common::{boolean, nginx_quoted, strings, unsigned_or};
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    let allow_credentials = boolean(config, "allow_credentials").unwrap_or(false);
    let origin = if allow_credentials {
        "$http_origin".to_string()
    } else {
        strings(config, "allow_origins")
            .and_then(|items| (items.len() == 1).then(|| items[0].clone()))
            .unwrap_or_else(|| "$http_origin".to_string())
    };
    let methods = strings(config, "allow_methods")
        .map(|items| items.join(", "))
        .unwrap_or_else(|| "GET, POST, PUT, DELETE, PATCH, OPTIONS".to_string());
    let headers = strings(config, "allow_headers")
        .map(|items| items.join(", "))
        .unwrap_or_else(|| "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,X-API-Key,X-Request-ID".to_string());

    server.push_str(&format!(
        "add_header Access-Control-Allow-Origin {} always;\n",
        nginx_quoted(&origin, "allow_origins")?
    ));
    server.push_str(&format!(
        "add_header Access-Control-Allow-Methods {} always;\n",
        nginx_quoted(&methods, "allow_methods")?
    ));
    server.push_str(&format!(
        "add_header Access-Control-Allow-Headers {} always;\n",
        nginx_quoted(&headers, "allow_headers")?
    ));
    server.push_str(&format!(
        "add_header Access-Control-Max-Age {} always;\n",
        unsigned_or(config, "max_age", 86400)
    ));
    if allow_credentials {
        server.push_str("add_header Access-Control-Allow-Credentials \"true\" always;\n");
    }
    if let Some(expose_headers) = strings(config, "expose_headers")
        && !expose_headers.is_empty()
    {
        server.push_str(&format!(
            "add_header Access-Control-Expose-Headers {} always;\n",
            nginx_quoted(&expose_headers.join(", "), "expose_headers")?
        ));
    }
    server.push_str("if ($request_method = 'OPTIONS') {\n    return 204;\n}\n");
    *has_server = true;

    Ok(())
}
