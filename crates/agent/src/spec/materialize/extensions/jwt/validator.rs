use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::array;
use serde_json::{Map, Value};

pub fn validate_jwt_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let origins = array(config, "origins")
        .or_else(|| array(config, "rules"))
        .ok_or_else(|| {
            format!(
                "decode JWT extension {} config: origins must be an array",
                instance.instance_id
            )
        })?;
    if origins.is_empty() || origins.len() > 16 {
        return Err(format!(
            "JWT extension {} must contain 1..=16 origins",
            instance.instance_id
        ));
    }
    Ok(())
}
