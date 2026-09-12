use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_canary_release_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode canary-release extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;

    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "canary-release extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());

    for (idx, rule_val) in rules.iter().enumerate() {
        let rule = rule_val.as_object().ok_or_else(|| {
            format!(
                "decode canary-release extension {} config: rule at index {idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = string(rule, "id").ok_or_else(|| {
            format!(
                "canary-release extension {} rule at index {idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 {
            return Err(format!(
                "canary-release extension {} rule at index {idx} has invalid id: length must be 1..=128",
                instance.instance_id
            ));
        }
        if !rule_ids.insert(id) {
            return Err(format!(
                "canary-release extension {} contains duplicate rule id: {id}",
                instance.instance_id
            ));
        }

        if let Some(priority) = unsigned(rule, "priority")
            && priority > 10_000
        {
            return Err(format!(
                "canary-release extension {} rule '{id}' priority must be 0..=10000",
                instance.instance_id
            ));
        }

        if let Some(origin) = string(rule, "origin") {
            if origin.is_empty() || origin.len() > 253 {
                return Err(format!(
                    "canary-release extension {} rule '{id}' has invalid origin length",
                    instance.instance_id
                ));
            }
            let valid = if origin == "*" {
                true
            } else if let Some(sub) = origin.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                origin
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };
            if !valid {
                return Err(format!(
                    "canary-release extension {} rule '{id}' has invalid origin syntax: {origin}",
                    instance.instance_id
                ));
            }
        }

        if let Some(path_prefix) = string(rule, "path_prefix")
            && (!path_prefix.starts_with('/') || path_prefix.len() > 8192)
        {
            return Err(format!(
                "canary-release extension {} rule '{id}' path_prefix must start with '/' and be <= 8192 characters",
                instance.instance_id
            ));
        }

        // Validate baseline_upstream and canary_upstream
        let baseline = string(rule, "baseline_upstream").ok_or_else(|| {
            format!(
                "canary-release extension {} rule '{id}' missing baseline_upstream",
                instance.instance_id
            )
        })?;
        if baseline.trim().is_empty()
            || baseline.len() > 128
            || !baseline
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        {
            return Err(format!(
                "canary-release extension {} rule '{id}' has invalid baseline_upstream name: '{baseline}'",
                instance.instance_id
            ));
        }

        let canary = string(rule, "canary_upstream").ok_or_else(|| {
            format!(
                "canary-release extension {} rule '{id}' missing canary_upstream",
                instance.instance_id
            )
        })?;
        if canary.trim().is_empty()
            || canary.len() > 128
            || !canary
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        {
            return Err(format!(
                "canary-release extension {} rule '{id}' has invalid canary_upstream name: '{canary}'",
                instance.instance_id
            ));
        }

        if baseline == canary {
            return Err(format!(
                "canary-release extension {} rule '{id}' baseline_upstream and canary_upstream must be distinct, got both '{baseline}'",
                instance.instance_id
            ));
        }

        // Validate match_conditions
        if let Some(conditions) = array(rule, "match_conditions") {
            if conditions.len() > 16 {
                return Err(format!(
                    "canary-release extension {} rule '{id}' match_conditions cannot exceed 16 items",
                    instance.instance_id
                ));
            }
            for (c_idx, c_val) in conditions.iter().enumerate() {
                let c_obj = c_val.as_object().ok_or_else(|| {
                    format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} must be an object",
                        instance.instance_id
                    )
                })?;

                let target = string(c_obj, "target").ok_or_else(|| {
                    format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} missing target",
                        instance.instance_id
                    )
                })?;
                if !matches!(target, "header" | "uri" | "query") {
                    return Err(format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} has invalid target: '{target}' (must be 'header', 'uri', or 'query')",
                        instance.instance_id
                    ));
                }

                if target == "header" {
                    let key = string(c_obj, "key").unwrap_or("");
                    if key.trim().is_empty()
                        || key.len() > 64
                        || !key
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    {
                        return Err(format!(
                            "canary-release extension {} rule '{id}' header match_condition requires valid key (1..=64 characters)",
                            instance.instance_id
                        ));
                    }
                }

                let regex_str = string(c_obj, "regex").ok_or_else(|| {
                    format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} missing regex",
                        instance.instance_id
                    )
                })?;
                if regex_str.is_empty() || regex_str.len() > 512 {
                    return Err(format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} regex length must be 1..=512",
                        instance.instance_id
                    ));
                }
                regex::Regex::new(regex_str).map_err(|err| {
                    format!(
                        "canary-release extension {} rule '{id}' match_condition at index {c_idx} invalid regex '{regex_str}': {err}",
                        instance.instance_id
                    )
                })?;
            }
        }

        // Validate weight_percentage
        if let Some(weight) = unsigned(rule, "weight_percentage")
            && weight > 100
        {
            return Err(format!(
                "canary-release extension {} rule '{id}' weight_percentage must be 0..=100, got {weight}",
                instance.instance_id
            ));
        }

        // Validate split_by
        let split_by = string(rule, "split_by").unwrap_or("client_ip");
        if !matches!(split_by, "client_ip" | "header" | "random") {
            return Err(format!(
                "canary-release extension {} rule '{id}' has invalid split_by: {split_by}",
                instance.instance_id
            ));
        }
        if split_by == "header" {
            let header_name = string(rule, "header_name").unwrap_or("");
            if header_name.trim().is_empty()
                || header_name.len() > 64
                || !header_name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                return Err(format!(
                    "canary-release extension {} rule '{id}' split_by 'header' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                    instance.instance_id
                ));
            }
        }

        // Validate upstream headers
        for list_key in &["canary_upstream_headers", "baseline_upstream_headers"] {
            if let Some(headers) = array(rule, list_key) {
                if headers.len() > 16 {
                    return Err(format!(
                        "canary-release extension {} rule '{id}' {list_key} cannot exceed 16 items",
                        instance.instance_id
                    ));
                }
                for (h_idx, h_val) in headers.iter().enumerate() {
                    let h_obj = h_val.as_object().ok_or_else(|| {
                        format!(
                            "canary-release extension {} rule '{id}' {list_key} at index {h_idx} must be an object",
                            instance.instance_id
                        )
                    })?;
                    let name = string(h_obj, "name").ok_or_else(|| {
                        format!(
                            "canary-release extension {} rule '{id}' {list_key} at index {h_idx} missing name",
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
                            "canary-release extension {} rule '{id}' {list_key} at index {h_idx} has invalid name: '{name}'",
                            instance.instance_id
                        ));
                    }
                    if let Some(val) = string(h_obj, "value")
                        && val.len() > 256
                    {
                        return Err(format!(
                            "canary-release extension {} rule '{id}' {list_key} at index {h_idx} value length must be <= 256",
                            instance.instance_id
                        ));
                    }
                }
            }
        }
    }

    Ok(())
}
