use super::validator::validate_request_termination_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    request_termination_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if request_termination_policy.is_some() {
        return Err("NodeSpec contains more than one request-termination extension".to_string());
    }

    validate_request_termination_config(instance, &config)?;

    *request_termination_policy = Some(Value::Object(config));
    server.push_str("gateway_request_termination_policy /var/lib/aurora-policy/active-request-termination.json;\n");
    *has_server = true;
    Ok(())
}
