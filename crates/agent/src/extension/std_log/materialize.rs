use crate::spec::extensions::{ExtensionInstanceSpec, StdLogSpec};
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    std_log_instances: &mut usize,
) -> Result<(), String> {
    *std_log_instances += 1;
    if *std_log_instances > 1 {
        return Err("NodeSpec contains more than one std-log extension".to_string());
    }

    let spec = serde_json::from_value::<StdLogSpec>(Value::Object(config)).map_err(|error| {
        format!(
            "decode std-log extension {} config: {error}",
            instance.instance_id
        )
    })?;

    if !matches!(
        spec.format.to_ascii_lowercase().as_str(),
        "json" | "text" | "combined"
    ) {
        return Err(format!(
            "std-log config: unsupported format '{}', must be 'json', 'text', or 'combined'",
            spec.format
        ));
    }

    if !matches!(
        spec.log_level.to_ascii_lowercase().as_str(),
        "info" | "warn" | "error" | "all"
    ) {
        return Err(format!(
            "std-log config: unsupported log_level '{}', must be 'info', 'warn', 'error', or 'all'",
            spec.log_level
        ));
    }

    Ok(())
}
