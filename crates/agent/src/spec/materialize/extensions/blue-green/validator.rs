use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_blue_green_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    if let Some(rules) = array(config, "rules") {
        if rules.is_empty() || rules.len() > 64 {
            return Err(format!(
                "blue-green extension {} must contain 1..=64 rules",
                instance.instance_id
            ));
        }

        let mut rule_ids = HashSet::with_capacity(rules.len());

        for (idx, rule_val) in rules.iter().enumerate() {
            let rule = rule_val.as_object().ok_or_else(|| {
                format!(
                    "decode blue-green extension {} config: rule at index {idx} must be an object",
                    instance.instance_id
                )
            })?;

            let id = string(rule, "id").ok_or_else(|| {
                format!(
                    "blue-green extension {} rule at index {idx} missing id",
                    instance.instance_id
                )
            })?;
            if id.trim().is_empty() || id.len() > 128 {
                return Err(format!(
                    "blue-green extension {} rule at index {idx} has invalid id: length must be 1..=128",
                    instance.instance_id
                ));
            }
            if !rule_ids.insert(id) {
                return Err(format!(
                    "blue-green extension {} contains duplicate rule id: {id}",
                    instance.instance_id
                ));
            }

            if let Some(priority) = unsigned(rule, "priority")
                && priority > 10_000
            {
                return Err(format!(
                    "blue-green extension {} rule '{id}' priority must be 0..=10000",
                    instance.instance_id
                ));
            }

            validate_rule_upstreams(instance, rule, id)?;
        }
    } else {
        // Flat format validation
        let blue = string(config, "blue_upstream").ok_or_else(|| {
            format!(
                "blue-green extension {} missing required field: blue_upstream",
                instance.instance_id
            )
        })?;
        let green = string(config, "green_upstream").ok_or_else(|| {
            format!(
                "blue-green extension {} missing required field: green_upstream",
                instance.instance_id
            )
        })?;
        if blue.trim().is_empty() || blue.len() > 128 || green.trim().is_empty() || green.len() > 128 {
            return Err(format!(
                "blue-green extension {} upstream names must be 1..=128 characters",
                instance.instance_id
            ));
        }
        if blue == green {
            return Err(format!(
                "blue-green extension {} blue_upstream and green_upstream must be distinct",
                instance.instance_id
            ));
        }
        if let Some(slot) = string(config, "active_slot") {
            let slot_lower = slot.trim().to_ascii_lowercase();
            if slot_lower != "blue" && slot_lower != "green" {
                return Err(format!(
                    "blue-green extension {} active_slot must be 'blue' or 'green', got '{slot}'",
                    instance.instance_id
                ));
            }
        }
    }

    Ok(())
}

fn validate_rule_upstreams(
    instance: &ExtensionInstanceSpec,
    rule: &Map<String, Value>,
    rule_id: &str,
) -> Result<(), String> {
    let blue = string(rule, "blue_upstream").ok_or_else(|| {
        format!(
            "blue-green extension {} rule '{rule_id}' missing blue_upstream",
            instance.instance_id
        )
    })?;
    let green = string(rule, "green_upstream").ok_or_else(|| {
        format!(
            "blue-green extension {} rule '{rule_id}' missing green_upstream",
            instance.instance_id
        )
    })?;

    if blue.trim().is_empty() || blue.len() > 128 || green.trim().is_empty() || green.len() > 128 {
        return Err(format!(
            "blue-green extension {} rule '{rule_id}' upstream names must be 1..=128 characters",
            instance.instance_id
        ));
    }
    if blue == green {
        return Err(format!(
            "blue-green extension {} rule '{rule_id}' blue_upstream and green_upstream must be distinct",
            instance.instance_id
        ));
    }

    if let Some(slot) = string(rule, "active_slot") {
        let slot_lower = slot.trim().to_ascii_lowercase();
        if slot_lower != "blue" && slot_lower != "green" {
            return Err(format!(
                "blue-green extension {} rule '{rule_id}' active_slot must be 'blue' or 'green', got '{slot}'",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
