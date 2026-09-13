use super::validator::validate_request_mirror_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    request_mirror_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if request_mirror_policy.is_some() {
        return Err("NodeSpec contains more than one request-mirror extension".to_string());
    }

    validate_request_mirror_config(instance, &config)?;

    *request_mirror_policy = Some(Value::Object(config));
    server.push_str("gateway_request_mirror_policy /var/lib/aurora-policy/active-request-mirror.json;\n");
    *has_server = true;
    Ok(())
}
