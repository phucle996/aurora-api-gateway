//! Response Header Transform extension materializer.

use super::common::{nginx_header_name, nginx_quoted, object, strings};
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
