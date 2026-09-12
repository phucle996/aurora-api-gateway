use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use regex::Regex;
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_request_size_limit_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode request-size-limit extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;

    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "request-size-limit extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());

    for (idx, rule_val) in rules.iter().enumerate() {
        let rule = rule_val.as_object().ok_or_else(|| {
            format!(
                "decode request-size-limit extension {} config: rule at index {idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = string(rule, "id").ok_or_else(|| {
            format!(
                "request-size-limit extension {} rule at index {idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 {
            return Err(format!(
                "request-size-limit extension {} rule at index {idx} has invalid id: length must be 1..=128",
                instance.instance_id
            ));
        }
        if !rule_ids.insert(id) {
            return Err(format!(
                "request-size-limit extension {} contains duplicate rule id: {id}",
                instance.instance_id
            ));
        }

        let max_req_bytes = unsigned(rule, "max_request_bytes").ok_or_else(|| {
            format!(
                "request-size-limit extension {} rule '{id}' missing max_request_bytes",
                instance.instance_id
            )
        })?;
        if max_req_bytes == 0 || max_req_bytes > 10_737_418_240 {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' max_request_bytes must be 1..=10737418240",
                instance.instance_id
            ));
        }

        if let Some(max_header_bytes) = unsigned(rule, "max_header_bytes")
            && max_header_bytes > 10_485_760
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' max_header_bytes must be 0..=10485760",
                instance.instance_id
            ));
        }

        if let Some(max_body_bytes) = unsigned(rule, "max_body_bytes")
            && max_body_bytes > 10_737_418_240
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' max_body_bytes must be 0..=10737418240",
                instance.instance_id
            ));
        }

        if let Some(priority) = unsigned(rule, "priority")
            && priority > 10_000
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' priority must be 0..=10000",
                instance.instance_id
            ));
        }

        if let Some(origin) = string(rule, "origin") {
            if origin.is_empty() || origin.len() > 253 {
                return Err(format!(
                    "request-size-limit extension {} rule '{id}' has invalid origin length",
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
                    "request-size-limit extension {} rule '{id}' has invalid origin syntax: {origin}",
                    instance.instance_id
                ));
            }
        }

        if let Some(path_prefix) = string(rule, "path_prefix")
            && (!path_prefix.starts_with('/') || path_prefix.len() > 8192)
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' path_prefix must start with '/' and be <= 8192 characters",
                instance.instance_id
            ));
        }

        let limit_by = string(rule, "limit_by").unwrap_or("client_ip");
        if !matches!(limit_by, "client_ip" | "header" | "route_path") {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' has invalid limit_by: {limit_by}",
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
                    "request-size-limit extension {} rule '{id}' limit_by 'header' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                    instance.instance_id
                ));
            }
        }

        if let Some(match_val) = string(rule, "match_value") {
            if match_val.len() > 256 {
                return Err(format!(
                    "request-size-limit extension {} rule '{id}' match_value length must be <= 256",
                    instance.instance_id
                ));
            }
            if match_val != "*" && !match_val.is_empty() {
                Regex::new(match_val).map_err(|e| {
                    format!(
                        "request-size-limit extension {} rule '{id}' has invalid regex match_value '{match_val}': {e}",
                        instance.instance_id
                    )
                })?;
            }
        }

        if let Some(code) = unsigned(rule, "rejected_code")
            && !(400..=599).contains(&code)
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' rejected_code must be 400..=599",
                instance.instance_id
            ));
        }

        if let Some(resp_body) = string(rule, "response_body")
            && resp_body.len() > 4096
        {
            return Err(format!(
                "request-size-limit extension {} rule '{id}' response_body length must be <= 4096 bytes",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
