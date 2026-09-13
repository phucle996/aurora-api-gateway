use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_request_mirror_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    if let Some(rules) = array(config, "rules") {
        if rules.is_empty() || rules.len() > 64 {
            return Err(format!(
                "request-mirror extension {} must contain 1..=64 rules",
                instance.instance_id
            ));
        }

        let mut rule_ids = HashSet::with_capacity(rules.len());

        for (idx, rule_val) in rules.iter().enumerate() {
            let rule = rule_val.as_object().ok_or_else(|| {
                format!(
                    "decode request-mirror extension {} config: rule at index {idx} must be an object",
                    instance.instance_id
                )
            })?;

            let id = string(rule, "id").ok_or_else(|| {
                format!(
                    "request-mirror extension {} rule at index {idx} missing id",
                    instance.instance_id
                )
            })?;
            if id.trim().is_empty() || id.len() > 128 {
                return Err(format!(
                    "request-mirror extension {} rule at index {idx} has invalid id: length must be 1..=128",
                    instance.instance_id
                ));
            }
            if !rule_ids.insert(id) {
                return Err(format!(
                    "request-mirror extension {} contains duplicate rule id: {id}",
                    instance.instance_id
                ));
            }

            if let Some(priority) = unsigned(rule, "priority")
                && priority > 10_000
            {
                return Err(format!(
                    "request-mirror extension {} rule '{id}' priority must be 0..=10000",
                    instance.instance_id
                ));
            }

            validate_rule_upstreams(instance, rule, id)?;
        }
    } else {
        // Flat format validation
        let primary = string(config, "primary_upstream").ok_or_else(|| {
            format!(
                "request-mirror extension {} missing required field: primary_upstream",
                instance.instance_id
            )
        })?;
        let mirror = string(config, "mirror_upstream").ok_or_else(|| {
            format!(
                "request-mirror extension {} missing required field: mirror_upstream",
                instance.instance_id
            )
        })?;
        if primary.trim().is_empty()
            || primary.len() > 128
            || mirror.trim().is_empty()
            || mirror.len() > 128
        {
            return Err(format!(
                "request-mirror extension {} upstream names must be 1..=128 characters",
                instance.instance_id
            ));
        }
        if primary == mirror {
            return Err(format!(
                "request-mirror extension {} primary_upstream and mirror_upstream must be distinct",
                instance.instance_id
            ));
        }
        if let Some(pct) = unsigned(config, "sample_percentage")
            && pct > 100
        {
            return Err(format!(
                "request-mirror extension {} sample_percentage must be 0..=100",
                instance.instance_id
            ));
        }
    }

    Ok(())
}

fn validate_rule_upstreams(
    instance: &ExtensionInstanceSpec,
    rule: &Map<String, Value>,
    rule_id: &str,
) -> Result<(), String> {
    let primary = string(rule, "primary_upstream").ok_or_else(|| {
        format!(
            "request-mirror extension {} rule '{rule_id}' missing primary_upstream",
            instance.instance_id
        )
    })?;
    let mirror = string(rule, "mirror_upstream").ok_or_else(|| {
        format!(
            "request-mirror extension {} rule '{rule_id}' missing mirror_upstream",
            instance.instance_id
        )
    })?;

    if primary.trim().is_empty()
        || primary.len() > 128
        || mirror.trim().is_empty()
        || mirror.len() > 128
    {
        return Err(format!(
            "request-mirror extension {} rule '{rule_id}' upstream names must be 1..=128 characters",
            instance.instance_id
        ));
    }
    if primary == mirror {
        return Err(format!(
            "request-mirror extension {} rule '{rule_id}' primary_upstream and mirror_upstream must be distinct",
            instance.instance_id
        ));
    }

    if let Some(pct) = unsigned(rule, "sample_percentage")
        && pct > 100
    {
        return Err(format!(
            "request-mirror extension {} rule '{rule_id}' sample_percentage must be 0..=100",
            instance.instance_id
        ));
    }

    Ok(())
}
