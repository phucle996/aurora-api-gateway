use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::array;
use regex::Regex;
use serde_json::{Map, Value};

pub fn validate_jwt_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let origins = array(config, "origins")
        .or_else(|| array(config, "rules"))
        .ok_or_else(|| {
            format!(
                "decode JWT extension {} config: origins must be an array",
                instance.instance_id
            )
        })?;
    if origins.is_empty() || origins.len() > 16 {
        return Err(format!(
            "JWT extension {} must contain 1..=16 origins",
            instance.instance_id
        ));
    }

    for (idx, origin) in origins.iter().enumerate() {
        let o_obj = origin.as_object().ok_or_else(|| {
            format!(
                "JWT extension {} origin #{idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = o_obj
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "JWT extension {} origin #{idx} missing required non-empty 'id'",
                    instance.instance_id
                )
            })?;

        if let Some(claim_rules) = o_obj.get("claim_rules").and_then(|v| v.as_array()) {
            if claim_rules.len() > 32 {
                return Err(format!(
                    "JWT extension {} origin '{id}' exceeds maximum 32 claim_rules",
                    instance.instance_id
                ));
            }
            for (cr_idx, cr) in claim_rules.iter().enumerate() {
                let cr_obj = cr.as_object().ok_or_else(|| {
                    format!(
                        "JWT extension {} origin '{id}' claim_rule #{cr_idx} must be an object",
                        instance.instance_id
                    )
                })?;
                let payload_key = cr_obj
                    .get("payload_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} missing 'payload_key'",
                            instance.instance_id
                        )
                    })?;
                if payload_key.len() > 64 {
                    return Err(format!(
                        "JWT extension {} origin '{id}' claim_rule #{cr_idx} 'payload_key' too long (max 64)",
                        instance.instance_id
                    ));
                }

                if let Some(header_key) = cr_obj.get("header_key").and_then(|v| v.as_str()) {
                    let h_trimmed = header_key.trim();
                    if !h_trimmed.is_empty()
                        && (h_trimmed.len() > 64
                            || !h_trimmed
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
                    {
                        return Err(format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} invalid 'header_key' '{h_trimmed}'",
                            instance.instance_id
                        ));
                    }
                }

                if let Some(pattern) = cr_obj.get("values_match").and_then(|v| v.as_str())
                    && pattern != "*"
                    && !pattern.trim().is_empty()
                {
                    Regex::new(pattern).map_err(|e| {
                        format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} invalid regex '{pattern}': {e}",
                            instance.instance_id
                        )
                    })?;
                }
            }
        }
    }

    Ok(())
}
