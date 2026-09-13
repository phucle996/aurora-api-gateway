use super::validator::validate_blue_green_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    blue_green_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if blue_green_policy.is_some() {
        return Err("NodeSpec contains more than one blue-green extension".to_string());
    }

    validate_blue_green_config(instance, &config)?;

    *blue_green_policy = Some(Value::Object(config));
    server.push_str("gateway_blue_green_policy /var/lib/aurora-policy/active-blue-green.json;\n");
    *has_server = true;
    Ok(())
}
