use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::array;
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
    let rules = array(&config, "rules").ok_or_else(|| {
        format!(
            "decode JWT extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;
    if rules.is_empty() || rules.len() > 8 {
        return Err(format!(
            "JWT extension {} must contain 1..=8 rules",
            instance.instance_id
        ));
    }
    *jwt_policy = Some(Value::Object(config));
    server.push_str("gateway_jwt_policy /var/lib/aurora-policy/active-jwt.json;\n");
    *has_server = true;
    Ok(())
}
