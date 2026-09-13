use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_request_termination_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    if let Some(rules) = array(config, "rules") {
        if rules.is_empty() || rules.len() > 64 {
            return Err(format!(
                "request-termination extension {} must contain 1..=64 rules",
                instance.instance_id
            ));
        }

        let mut rule_ids = HashSet::with_capacity(rules.len());

        for (idx, rule_val) in rules.iter().enumerate() {
            let rule = rule_val.as_object().ok_or_else(|| {
                format!(
                    "decode request-termination extension {} config: rule at index {idx} must be an object",
                    instance.instance_id
                )
            })?;

            let id = string(rule, "id").ok_or_else(|| {
                format!(
                    "request-termination extension {} rule at index {idx} missing id",
                    instance.instance_id
                )
            })?;
            if id.trim().is_empty() || id.len() > 128 {
                return Err(format!(
                    "request-termination extension {} rule at index {idx} has invalid id: length must be 1..=128",
                    instance.instance_id
                ));
            }
            if !rule_ids.insert(id) {
                return Err(format!(
                    "request-termination extension {} contains duplicate rule id: {id}",
                    instance.instance_id
                ));
            }

            if let Some(priority) = unsigned(rule, "priority")
                && priority > 10_000
            {
                return Err(format!(
                    "request-termination extension {} rule '{id}' priority must be 0..=10000",
                    instance.instance_id
                ));
            }

            if let Some(status_code) = unsigned(rule, "status_code")
                && !(200..=599).contains(&status_code)
            {
                return Err(format!(
                    "request-termination extension {} rule '{id}' status_code must be 200..=599",
                    instance.instance_id
                ));
            }

            if let Some(ct) = string(rule, "content_type")
                && (ct.trim().is_empty() || ct.len() > 128)
            {
                return Err(format!(
                    "request-termination extension {} rule '{id}' content_type length must be 1..=128",
                    instance.instance_id
                ));
            }

            if let Some(b) = string(rule, "body")
                && b.len() > 65536
            {
                return Err(format!(
                    "request-termination extension {} rule '{id}' body exceeds maximum 64KB",
                    instance.instance_id
                ));
            }

            validate_headers(instance, rule, "headers", id)?;
            validate_headers(instance, rule, "bypass_headers", id)?;
        }
    } else {
        // Flat format validation
        if let Some(status_code) = unsigned(config, "status_code")
            && !(200..=599).contains(&status_code)
        {
            return Err(format!(
                "request-termination extension {} status_code must be 200..=599",
                instance.instance_id
            ));
        }

        if let Some(ct) = string(config, "content_type")
            && (ct.trim().is_empty() || ct.len() > 128)
        {
            return Err(format!(
                "request-termination extension {} content_type length must be 1..=128",
                instance.instance_id
            ));
        }

        if let Some(b) = string(config, "body")
            && b.len() > 65536
        {
            return Err(format!(
                "request-termination extension {} body exceeds maximum 64KB",
                instance.instance_id
            ));
        }

        validate_headers(instance, config, "headers", "flat")?;
        validate_headers(instance, config, "bypass_headers", "flat")?;
    }

    Ok(())
}

fn validate_headers(
    instance: &ExtensionInstanceSpec,
    parent: &Map<String, Value>,
    key: &str,
    context_id: &str,
) -> Result<(), String> {
    if let Some(headers) = array(parent, key) {
        if headers.len() > 16 {
            return Err(format!(
                "request-termination extension {} '{context_id}' exceeds max 16 {key}",
                instance.instance_id
            ));
        }

        for (idx, h_val) in headers.iter().enumerate() {
            let h = h_val.as_object().ok_or_else(|| {
                format!(
                    "request-termination extension {} '{context_id}' {key} at {idx} must be an object",
                    instance.instance_id
                )
            })?;

            let name = string(h, "name").ok_or_else(|| {
                format!(
                    "request-termination extension {} '{context_id}' {key} at {idx} missing 'name'",
                    instance.instance_id
                )
            })?;
            if name.trim().is_empty() || name.len() > 64 {
                return Err(format!(
                    "request-termination extension {} '{context_id}' {key} name must be 1..=64 chars",
                    instance.instance_id
                ));
            }

            if let Some(val) = string(h, "value")
                && val.len() > 256
            {
                return Err(format!(
                    "request-termination extension {} '{context_id}' {key} value must be <= 256 chars",
                    instance.instance_id
                ));
            }
        }
    }

    Ok(())
}
