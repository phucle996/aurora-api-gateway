//! Response Header Transform extension materializer.
//!
//! Controls and enriches HTTP response headers returned to downstream clients. Uses `add_header ... always`
//! to ensure headers are retained even on upstream error status codes (4xx/5xx). Configures `proxy_hide_header`
//! to prevent internal backend metadata or framework fingerprints (e.g. `Server`, `X-Powered-By`) from
//! leaking to public consumers.
//!
//! Generated directives are written to `/var/lib/aurora-policy/active-extensions.conf` and injected
//! into the `server { ... }` block, taking effect with zero downtime via `aurora-gateway -s reload`.

use crate::spec::materialize::extensions::common::{
    nginx_header_name, nginx_quoted, object, strings,
};
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if let Some(headers) = object(config, "add_headers") {
        for (name, value) in headers {
            let value = value
                .as_str()
                .ok_or_else(|| format!("extension header {name} must be a string"))?;
            server.push_str(&format!(
                "add_header {} {} always;\n",
                nginx_header_name(name)?,
                nginx_quoted(value, "add_headers")?,
            ));
            *has_server = true;
        }
    }
    if let Some(headers) = strings(config, "remove_headers") {
        for name in headers {
            server.push_str(&format!(
                "proxy_hide_header {};\n",
                nginx_header_name(&name)?,
            ));
            *has_server = true;
        }
    }
    Ok(())
}
