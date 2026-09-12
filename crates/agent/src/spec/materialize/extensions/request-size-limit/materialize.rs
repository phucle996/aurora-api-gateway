use super::validator::validate_request_size_limit_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    request_size_limit_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if request_size_limit_policy.is_some() {
        return Err("NodeSpec contains more than one request-size-limit extension".to_string());
    }

    validate_request_size_limit_config(instance, &config)?;

    *request_size_limit_policy = Some(Value::Object(config));
    server.push_str(
        "gateway_request_size_limit_policy /var/lib/aurora-policy/active-request-size-limit.json;\n",
    );
    *has_server = true;
    Ok(())
}
