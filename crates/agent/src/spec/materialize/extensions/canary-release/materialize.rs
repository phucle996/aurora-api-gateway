use super::validator::validate_canary_release_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    canary_release_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if canary_release_policy.is_some() {
        return Err("NodeSpec contains more than one canary-release extension".to_string());
    }

    validate_canary_release_config(instance, &config)?;

    *canary_release_policy = Some(Value::Object(config));
    server.push_str("gateway_canary_release_policy /var/lib/aurora-policy/active-canary-release.json;\n");
    *has_server = true;
    Ok(())
}
