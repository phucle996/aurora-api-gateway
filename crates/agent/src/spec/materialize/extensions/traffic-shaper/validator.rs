use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_traffic_shaper_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode traffic-shaper extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;

    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "traffic-shaper extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());

    for (idx, rule_val) in rules.iter().enumerate() {
        let rule = rule_val.as_object().ok_or_else(|| {
            format!(
                "decode traffic-shaper extension {} config: rule at index {idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = string(rule, "id").ok_or_else(|| {
            format!(
                "traffic-shaper extension {} rule at index {idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 {
            return Err(format!(
                "traffic-shaper extension {} rule at index {idx} has invalid id: length must be 1..=128",
                instance.instance_id
            ));
        }
        if !rule_ids.insert(id) {
            return Err(format!(
                "traffic-shaper extension {} contains duplicate rule id: {id}",
                instance.instance_id
            ));
        }

        let rate = unsigned(rule, "rate_kb_per_sec").ok_or_else(|| {
            format!(
                "traffic-shaper extension {} rule '{id}' missing rate_kb_per_sec",
                instance.instance_id
            )
        })?;
        if rate == 0 || rate > 10_000_000 {
            return Err(format!(
                "traffic-shaper extension {} rule '{id}' rate_kb_per_sec must be 1..=10000000",
                instance.instance_id
            ));
        }

        if let Some(burst) = unsigned(rule, "burst_kb")
            && burst > 10_000_000
        {
            return Err(format!(
                "traffic-shaper extension {} rule '{id}' burst_kb must be 0..=10000000",
                instance.instance_id
            ));
        }

        if let Some(priority) = unsigned(rule, "priority")
            && priority > 10_000
        {
            return Err(format!(
                "traffic-shaper extension {} rule '{id}' priority must be 0..=10000",
                instance.instance_id
            ));
        }

        if let Some(limit_by) = string(rule, "limit_by") {
            if !matches!(limit_by, "client_ip" | "header" | "route_path") {
                return Err(format!(
                    "traffic-shaper extension {} rule '{id}' has invalid limit_by: {limit_by}",
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
                        "traffic-shaper extension {} rule '{id}' limit_by 'header' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                        instance.instance_id
                    ));
                }
            }
        }

        if let Some(host) = string(rule, "host") {
            if host.is_empty() || host.len() > 253 {
                return Err(format!(
                    "traffic-shaper extension {} rule '{id}' has invalid host length",
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
                    "traffic-shaper extension {} rule '{id}' has invalid host syntax: {host}",
                    instance.instance_id
                ));
            }
        }

        if let Some(path_prefix) = string(rule, "path_prefix")
            && (!path_prefix.starts_with('/') || path_prefix.len() > 8192)
        {
            return Err(format!(
                "traffic-shaper extension {} rule '{id}' path_prefix must start with '/' and be <= 8192 characters",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
