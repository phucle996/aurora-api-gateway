use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_traffic_split_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode traffic-split extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;

    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "traffic-split extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());

    for (idx, rule_val) in rules.iter().enumerate() {
        let rule = rule_val.as_object().ok_or_else(|| {
            format!(
                "decode traffic-split extension {} config: rule at index {idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = string(rule, "id").ok_or_else(|| {
            format!(
                "traffic-split extension {} rule at index {idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 {
            return Err(format!(
                "traffic-split extension {} rule at index {idx} has invalid id: length must be 1..=128",
                instance.instance_id
            ));
        }
        if !rule_ids.insert(id) {
            return Err(format!(
                "traffic-split extension {} contains duplicate rule id: {id}",
                instance.instance_id
            ));
        }

        if let Some(priority) = unsigned(rule, "priority")
            && priority > 10_000
        {
            return Err(format!(
                "traffic-split extension {} rule '{id}' priority must be 0..=10000",
                instance.instance_id
            ));
        }

        if let Some(origin) = string(rule, "origin") {
            if origin.is_empty() || origin.len() > 253 {
                return Err(format!(
                    "traffic-split extension {} rule '{id}' has invalid origin length",
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
                    "traffic-split extension {} rule '{id}' has invalid origin syntax: {origin}",
                    instance.instance_id
                ));
            }
        }

        if let Some(path_prefix) = string(rule, "path_prefix")
            && (!path_prefix.starts_with('/') || path_prefix.len() > 8192)
        {
            return Err(format!(
                "traffic-split extension {} rule '{id}' path_prefix must start with '/' and be <= 8192 characters",
                instance.instance_id
            ));
        }

        let split_by = string(rule, "split_by").unwrap_or("client_ip");
        if !matches!(split_by, "client_ip" | "header" | "random") {
            return Err(format!(
                "traffic-split extension {} rule '{id}' has invalid split_by: {split_by}",
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
                    "traffic-split extension {} rule '{id}' split_by '{split_by}' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                    instance.instance_id
                ));
            }
        }

        // Validate splits: minimum 2 upstreams, total weight == 100
        let splits = array(rule, "splits").ok_or_else(|| {
            format!(
                "traffic-split extension {} rule '{id}' missing splits array",
                instance.instance_id
            )
        })?;

        if splits.len() < 2 || splits.len() > 16 {
            return Err(format!(
                "traffic-split extension {} rule '{id}' splits must contain 2..=16 upstream targets",
                instance.instance_id
            ));
        }

        let mut total_weight: u64 = 0;
        let mut upstreams_seen = HashSet::with_capacity(splits.len());

        for (s_idx, split_val) in splits.iter().enumerate() {
            let split_obj = split_val.as_object().ok_or_else(|| {
                format!(
                    "traffic-split extension {} rule '{id}' split at index {s_idx} must be an object",
                    instance.instance_id
                )
            })?;

            let upstream = string(split_obj, "upstream").ok_or_else(|| {
                format!(
                    "traffic-split extension {} rule '{id}' split at index {s_idx} missing upstream",
                    instance.instance_id
                )
            })?;
            if upstream.trim().is_empty()
                || upstream.len() > 128
                || !upstream
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
            {
                return Err(format!(
                    "traffic-split extension {} rule '{id}' split at index {s_idx} has invalid upstream name: '{upstream}'",
                    instance.instance_id
                ));
            }
            if !upstreams_seen.insert(upstream) {
                return Err(format!(
                    "traffic-split extension {} rule '{id}' contains duplicate upstream target: '{upstream}'",
                    instance.instance_id
                ));
            }

            let weight = unsigned(split_obj, "weight").ok_or_else(|| {
                format!(
                    "traffic-split extension {} rule '{id}' upstream '{upstream}' missing weight",
                    instance.instance_id
                )
            })?;
            if weight == 0 || weight >= 100 {
                return Err(format!(
                    "traffic-split extension {} rule '{id}' upstream '{upstream}' weight must be 1..=99",
                    instance.instance_id
                ));
            }
            total_weight = total_weight.saturating_add(weight);
        }

        if total_weight != 100 {
            return Err(format!(
                "traffic-split extension {} rule '{id}' splits weight sum must equal exactly 100, got {total_weight}",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
