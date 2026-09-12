use super::validator::validate_rate_limit_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    rate_limit_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if rate_limit_policy.is_some() {
        return Err("NodeSpec contains more than one rate-limit extension".to_string());
    }

    validate_rate_limit_config(instance, &config)?;

    *rate_limit_policy = Some(Value::Object(config));
    server.push_str("gateway_rate_limit_policy /var/lib/aurora-policy/active-rate-limit.json;\n");
    *has_server = true;
    Ok(())
}
