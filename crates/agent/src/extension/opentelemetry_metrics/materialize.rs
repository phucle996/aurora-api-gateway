use super::config::OtlpMetricsConfig;
use crate::spec::materialize::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    opentelemetry_metrics_instances: &mut usize,
) -> Result<(), String> {
    *opentelemetry_metrics_instances += 1;
    if *opentelemetry_metrics_instances > 1 {
        return Err("NodeSpec contains more than one opentelemetry-metrics extension".to_string());
    }
    let spec =
        serde_json::from_value::<OtlpMetricsConfig>(Value::Object(config)).map_err(|error| {
            format!(
                "decode opentelemetry-metrics extension {} config: {error}",
                instance.instance_id
            )
        })?;

    if spec.endpoint.trim().is_empty() {
        return Err("opentelemetry-metrics config: endpoint cannot be empty".to_string());
    }
    if spec.protocol != "http" && spec.protocol != "grpc" {
        return Err(format!(
            "opentelemetry-metrics config: unsupported protocol '{}', must be 'http' or 'grpc'",
            spec.protocol
        ));
    }
    if !(1..=3600).contains(&spec.interval_secs) {
        return Err(format!(
            "opentelemetry-metrics config: interval_secs {} must be between 1 and 3600",
            spec.interval_secs
        ));
    }
    if !(100..=60000).contains(&spec.timeout_ms) {
        return Err(format!(
            "opentelemetry-metrics config: timeout_ms {} must be between 100 and 60000",
            spec.timeout_ms
        ));
    }
    if spec.service_name.trim().is_empty() {
        return Err("opentelemetry-metrics config: service_name cannot be empty".to_string());
    }

    Ok(())
}
