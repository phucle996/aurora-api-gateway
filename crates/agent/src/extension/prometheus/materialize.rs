use crate::spec::extensions::{ExtensionInstanceSpec, MetricsExtensionSpec};
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    metrics_instances: &mut usize,
) -> Result<(), String> {
    *metrics_instances += 1;
    if *metrics_instances > 1 {
        return Err("NodeSpec contains more than one agent-metrics extension".to_string());
    }
    serde_json::from_value::<MetricsExtensionSpec>(Value::Object(config)).map_err(|error| {
        format!(
            "decode metrics extension {} config: {error}",
            instance.instance_id
        )
    })?;
    Ok(())
}
