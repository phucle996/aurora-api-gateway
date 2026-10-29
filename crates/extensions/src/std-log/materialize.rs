//! Standard Stream & Structured Log (`builtin/std-log`) Materializer.
//!
//! Emits the declarative `gateway_std_log on | off | <path>;` directive into
//! the NGINX server configuration block, eliminating NGINX's native `access_log`.

use crate::materialize::common::boolean;
use serde_json::{Map, Value};

pub fn materialize(
    config: &Map<String, Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    let enabled = boolean(config, "enabled").unwrap_or(true);
    if enabled {
        server.push_str("    gateway_std_log on;\n");
        *has_server = true;
    } else {
        server.push_str("    gateway_std_log off;\n");
        *has_server = true;
    }
    Ok(())
}
