//! Request Header Transform extension materializer.

use super::common::{
    boolean, nginx_header_name, nginx_quoted, nginx_request_header_variable, object, string_or,
    strings,
};
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if !boolean(config, "enabled").unwrap_or(true) {
        return Ok(());
    }

    let mode = string_or(config, "mode", "denylist");
    if mode == "allowlist" {
        server.push_str("proxy_pass_request_headers off;\n");
        server.push_str("proxy_set_header Host $host;\n");
        server.push_str("proxy_set_header Content-Type $content_type;\n");
        server.push_str("proxy_set_header Content-Length $content_length;\n");
        if let Some(headers) = strings(config, "allowlist") {
            for name in headers {
                let header_directive = nginx_header_name(&name)?;
                let variable = nginx_request_header_variable(&name)?;
                server.push_str(&format!(
                    "proxy_set_header {header_directive} {variable};\n"
                ));
            }
        }
        *has_server = true;
    }

    let remove_list = strings(config, "remove_headers").or_else(|| strings(config, "denylist"));
    if let Some(headers) = remove_list {
        for name in headers {
            let header_directive = nginx_header_name(&name)?;
            server.push_str(&format!("proxy_set_header {header_directive} \"\";\n"));
            *has_server = true;
        }
    }

    if let Some(headers) = object(config, "add_headers") {
        for (name, value) in headers {
            let value = value
                .as_str()
                .ok_or_else(|| format!("extension header {name} must be a string"))?;
            server.push_str(&format!(
                "proxy_set_header {} {};\n",
                nginx_header_name(name)?,
                nginx_quoted(value, "add_headers")?,
            ));
            *has_server = true;
        }
    }

    Ok(())
}
