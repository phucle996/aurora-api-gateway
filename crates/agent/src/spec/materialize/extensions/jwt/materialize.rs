use super::validator::validate_jwt_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    jwt_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if jwt_policy.is_some() {
        return Err("NodeSpec contains more than one engine-jwt-rs256 extension".to_string());
    }

    validate_jwt_config(instance, &config)?;

    *jwt_policy = Some(Value::Object(config));
    server.push_str("gateway_jwt_policy /var/lib/aurora-policy/active-jwt.json;\n");
    *has_server = true;
    Ok(())
}
