use super::config::OtlpLogsConfig;
use crate::spec::materialize::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value};

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: Map<String, Value>,
    opentelemetry_logs_instances: &mut usize,
) -> Result<(), String> {
    *opentelemetry_logs_instances += 1;
    if *opentelemetry_logs_instances > 1 {
        return Err("NodeSpec contains more than one opentelemetry-logs extension".to_string());
    }
    let spec =
        serde_json::from_value::<OtlpLogsConfig>(Value::Object(config)).map_err(|error| {
            format!(
                "decode opentelemetry-logs extension {} config: {error}",
                instance.instance_id
            )
        })?;

    if spec.endpoint.trim().is_empty() {
        return Err("opentelemetry-logs config: endpoint cannot be empty".to_string());
    }
    if spec.protocol != "http" && spec.protocol != "grpc" {
        return Err(format!(
            "opentelemetry-logs config: unsupported protocol '{}', must be 'http' or 'grpc'",
            spec.protocol
        ));
    }
    if !(1..=5000).contains(&spec.batch_size) {
        return Err(format!(
            "opentelemetry-logs config: batch_size {} must be between 1 and 5000",
            spec.batch_size
        ));
    }
    if !(100..=60000).contains(&spec.flush_interval_ms) {
        return Err(format!(
            "opentelemetry-logs config: flush_interval_ms {} must be between 100 and 60000",
            spec.flush_interval_ms
        ));
    }
    if !(100..=60000).contains(&spec.timeout_ms) {
        return Err(format!(
            "opentelemetry-logs config: timeout_ms {} must be between 100 and 60000",
            spec.timeout_ms
        ));
    }
    if spec.service_name.trim().is_empty() {
        return Err("opentelemetry-logs config: service_name cannot be empty".to_string());
    }
    if !matches!(spec.log_level.as_str(), "info" | "warn" | "error" | "all") {
        return Err(format!(
            "opentelemetry-logs config: unsupported log_level '{}', must be 'info', 'warn', 'error', or 'all'",
            spec.log_level
        ));
    }

    Ok(())
}
