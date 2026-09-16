use crate::spec::extensions::{ExtensionInstanceSpec, OpenTelemetryTracingSpec};
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    opentelemetry_tracing_instances: &mut usize,
) -> Result<(), String> {
    *opentelemetry_tracing_instances += 1;
    if *opentelemetry_tracing_instances > 1 {
        return Err("NodeSpec contains more than one opentelemetry-tracing extension".to_string());
    }
    let spec = serde_json::from_value::<OpenTelemetryTracingSpec>(Value::Object(config)).map_err(
        |error| {
            format!(
                "decode opentelemetry-tracing extension {} config: {error}",
                instance.instance_id
            )
        },
    )?;

    if spec.endpoint.trim().is_empty() {
        return Err("opentelemetry-tracing config: endpoint cannot be empty".to_string());
    }
    if spec.protocol != "http" && spec.protocol != "grpc" {
        return Err(format!(
            "opentelemetry-tracing config: unsupported protocol '{}', must be 'http' or 'grpc'",
            spec.protocol
        ));
    }
    if !(0.0..=1.0).contains(&spec.sample_rate) {
        return Err(format!(
            "opentelemetry-tracing config: sample_rate {} must be between 0.0 and 1.0",
            spec.sample_rate
        ));
    }
    if !(1..=5000).contains(&spec.batch_size) {
        return Err(format!(
            "opentelemetry-tracing config: batch_size {} must be between 1 and 5000",
            spec.batch_size
        ));
    }
    if !(100..=60000).contains(&spec.flush_interval_ms) {
        return Err(format!(
            "opentelemetry-tracing config: flush_interval_ms {} must be between 100 and 60000",
            spec.flush_interval_ms
        ));
    }
    if !(100..=60000).contains(&spec.timeout_ms) {
        return Err(format!(
            "opentelemetry-tracing config: timeout_ms {} must be between 100 and 60000",
            spec.timeout_ms
        ));
    }
    if spec.service_name.trim().is_empty() {
        return Err("opentelemetry-tracing config: service_name cannot be empty".to_string());
    }

    Ok(())
}
