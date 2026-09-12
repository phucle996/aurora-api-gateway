use super::validator::validate_connection_limit_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    conn_limit_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if conn_limit_policy.is_some() {
        return Err("NodeSpec contains more than one connection-limit extension".to_string());
    }

    validate_connection_limit_config(instance, &config)?;

    *conn_limit_policy = Some(Value::Object(config));
    server.push_str(
        "gateway_conn_limit_policy /var/lib/aurora-policy/active-connection-limit.json;\n",
    );
    *has_server = true;
    Ok(())
}
