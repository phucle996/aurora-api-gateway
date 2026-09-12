use super::validator::validate_traffic_split_config;
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    traffic_split_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if traffic_split_policy.is_some() {
        return Err("NodeSpec contains more than one traffic-split extension".to_string());
    }

    validate_traffic_split_config(instance, &config)?;

    *traffic_split_policy = Some(Value::Object(config));
    server.push_str("gateway_traffic_split_policy /var/lib/aurora-policy/active-traffic-split.json;\n");
    *has_server = true;
    Ok(())
}
