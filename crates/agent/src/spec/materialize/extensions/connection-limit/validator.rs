use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_connection_limit_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode connection-limit extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;
    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "connection-limit extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }

    if let Some(mode) = string(config, "mode") {
        if !matches!(mode, "local" | "distributed") {
            return Err(format!(
                "connection-limit extension {} has invalid mode: {mode} (must be 'local' or 'distributed')",
                instance.instance_id
            ));
        }
        if mode == "distributed" {
            if let Some(redis) = config.get("redis").and_then(Value::as_object) {
                let endpoint = redis.get("endpoint").and_then(Value::as_str).unwrap_or("");
                if endpoint.trim().is_empty() {
                    return Err(format!(
                        "connection-limit extension {} distributed mode requires non-empty redis.endpoint",
                        instance.instance_id
                    ));
                }
                if let Some(on_error) = redis.get("on_error").and_then(Value::as_str)
                    && !matches!(on_error, "fallback_local" | "pass" | "block")
                {
                    return Err(format!(
                        "connection-limit extension {} has invalid redis.on_error: {on_error}",
                        instance.instance_id
                    ));
                }
                if let Some(timeout_ms) = redis.get("timeout_ms").and_then(Value::as_u64)
                    && (timeout_ms == 0 || timeout_ms > 5000)
                {
                    return Err(format!(
                        "connection-limit extension {} redis.timeout_ms must be 1..=5000",
                        instance.instance_id
                    ));
                }
                if let Some(pool_size) = redis.get("pool_size").and_then(Value::as_u64)
                    && (pool_size == 0 || pool_size > 64)
                {
                    return Err(format!(
                        "connection-limit extension {} redis.pool_size must be 1..=64",
                        instance.instance_id
                    ));
                }
                if let Some(lease_ttl_secs) = redis.get("lease_ttl_secs").and_then(Value::as_u64)
                    && !(5..=86400).contains(&lease_ttl_secs)
                {
                    return Err(format!(
                        "connection-limit extension {} redis.lease_ttl_secs must be 5..=86400",
                        instance.instance_id
                    ));
                }
                if let Some(tls) = redis.get("tls").and_then(Value::as_object)
                    && let Some(ca) = tls.get("ca_cert_pem").and_then(Value::as_str)
                    && (ca.trim().is_empty() || ca.len() > 32768)
                {
                    return Err(format!(
                        "connection-limit extension {} redis.tls.ca_cert_pem cannot be empty or exceed 32KB",
                        instance.instance_id
                    ));
                }
            } else {
                return Err(format!(
                    "connection-limit extension {} in distributed mode requires a 'redis' config object",
                    instance.instance_id
                ));
            }
        }
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());
    for (idx, rule_val) in rules.iter().enumerate() {
        let rule = rule_val.as_object().ok_or_else(|| {
            format!(
                "decode connection-limit extension {} config: rule at index {idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = string(rule, "id").ok_or_else(|| {
            format!(
                "connection-limit extension {} rule at index {idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 {
            return Err(format!(
                "connection-limit extension {} rule at index {idx} has invalid id: length must be 1..=128",
                instance.instance_id
            ));
        }
        if !rule_ids.insert(id) {
            return Err(format!(
                "connection-limit extension {} contains duplicate rule id: {id}",
                instance.instance_id
            ));
        }

        let max_connections = unsigned(rule, "max_connections").ok_or_else(|| {
            format!(
                "connection-limit extension {} rule '{id}' missing max_connections",
                instance.instance_id
            )
        })?;
        if max_connections == 0 {
            return Err(format!(
                "connection-limit extension {} rule '{id}' max_connections must be >= 1",
                instance.instance_id
            ));
        }

        if let Some(limit_by) = string(rule, "limit_by") {
            if !matches!(limit_by, "client_ip" | "header" | "route_path") {
                return Err(format!(
                    "connection-limit extension {} rule '{id}' has invalid limit_by: {limit_by}",
                    instance.instance_id
                ));
            }
            if limit_by == "header" {
                let header_name = string(rule, "header_name").unwrap_or("");
                if header_name.trim().is_empty()
                    || header_name.len() > 64
                    || !header_name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(format!(
                        "connection-limit extension {} rule '{id}' limit_by 'header' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                        instance.instance_id
                    ));
                }
            }
        }

        if let Some(host) = string(rule, "host") {
            if host.is_empty() || host.len() > 253 {
                return Err(format!(
                    "connection-limit extension {} rule '{id}' has invalid host length",
                    instance.instance_id
                ));
            }
            let valid = if host == "*" {
                true
            } else if let Some(sub) = host.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                host.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };
            if !valid {
                return Err(format!(
                    "connection-limit extension {} rule '{id}' has invalid host syntax: {host}",
                    instance.instance_id
                ));
            }
        }

        if let Some(path_prefix) = string(rule, "path_prefix")
            && (!path_prefix.starts_with('/') || path_prefix.len() > 8192)
        {
            return Err(format!(
                "connection-limit extension {} rule '{id}' path_prefix must start with '/' and be <= 8192 characters",
                instance.instance_id
            ));
        }

        if let Some(action) = string(rule, "action_on_exceeded")
            && !matches!(action, "throttle" | "block" | "audit" | "custom_response")
        {
            return Err(format!(
                "connection-limit extension {} rule '{id}' has invalid action_on_exceeded: {action}",
                instance.instance_id
            ));
        }

        if let Some(code) = unsigned(rule, "rejected_code")
            && !(200..=599).contains(&code)
        {
            return Err(format!(
                "connection-limit extension {} rule '{id}' rejected_code must be 200..=599",
                instance.instance_id
            ));
        }

        if let Some(headers) = array(rule, "response_headers") {
            if headers.len() > 8 {
                return Err(format!(
                    "connection-limit extension {} rule '{id}' response_headers cannot exceed 8 headers",
                    instance.instance_id
                ));
            }
            for (h_idx, hdr_val) in headers.iter().enumerate() {
                let hdr = hdr_val.as_object().ok_or_else(|| {
                    format!(
                        "connection-limit extension {} rule '{id}' response_headers[{h_idx}] must be an object",
                        instance.instance_id
                    )
                })?;
                let name = string(hdr, "name").ok_or_else(|| {
                    format!(
                        "connection-limit extension {} rule '{id}' response_headers[{h_idx}] missing name",
                        instance.instance_id
                    )
                })?;
                let value = string(hdr, "value").ok_or_else(|| {
                    format!(
                        "connection-limit extension {} rule '{id}' response_headers[{h_idx}] missing value",
                        instance.instance_id
                    )
                })?;
                if name.trim().is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(format!(
                        "connection-limit extension {} rule '{id}' response_headers[{h_idx}] has invalid name",
                        instance.instance_id
                    ));
                }
                if value.len() > 256 {
                    return Err(format!(
                        "connection-limit extension {} rule '{id}' response_headers[{h_idx}] value exceeds 256 bytes",
                        instance.instance_id
                    ));
                }
            }
        }

        if let Some(body) = string(rule, "response_body")
            && body.len() > 2048
        {
            return Err(format!(
                "connection-limit extension {} rule '{id}' response_body exceeds 2048 bytes",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
