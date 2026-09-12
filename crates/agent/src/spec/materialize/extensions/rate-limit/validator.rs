use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{array, string, unsigned};
use serde_json::{Map, Value};
use std::collections::HashSet;

pub fn validate_rate_limit_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let rules = array(config, "rules").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: rules must be an array",
            instance.instance_id
        )
    })?;
    if rules.is_empty() || rules.len() > 64 {
        return Err(format!(
            "rate-limit extension {} must contain 1..=64 rules",
            instance.instance_id
        ));
    }
    let algorithm = string(config, "algorithm").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: missing algorithm",
            instance.instance_id
        )
    })?;
    if !matches!(
        algorithm,
        "token_bucket" | "leaky_bucket" | "fixed_window" | "sliding_window"
    ) {
        return Err(format!(
            "rate-limit extension {} has invalid algorithm: {algorithm}",
            instance.instance_id
        ));
    }
    let mem_mb = unsigned(config, "memory_size_mb").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: missing memory_size_mb",
            instance.instance_id
        )
    })?;
    if mem_mb == 0 || mem_mb > 1024 {
        return Err(format!(
            "rate-limit extension {} memory_size_mb must be 1..=1024",
            instance.instance_id
        ));
    }
    let max_keys = unsigned(config, "max_keys").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: missing max_keys",
            instance.instance_id
        )
    })?;
    if !(16..=5_000_000).contains(&max_keys) {
        return Err(format!(
            "rate-limit extension {} max_keys must be 16..=5000000",
            instance.instance_id
        ));
    }
    let eviction = string(config, "eviction_policy").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: missing eviction_policy",
            instance.instance_id
        )
    })?;
    if !matches!(eviction, "lru" | "lfu" | "fifo") {
        return Err(format!(
            "rate-limit extension {} has invalid eviction_policy: {eviction}",
            instance.instance_id
        ));
    }
    let overflow = string(config, "overflow_strategy").ok_or_else(|| {
        format!(
            "decode rate-limit extension {} config: missing overflow_strategy",
            instance.instance_id
        )
    })?;
    if !matches!(overflow, "evict_and_track" | "drop_new" | "bypass_new") {
        return Err(format!(
            "rate-limit extension {} has invalid overflow_strategy: {overflow}",
            instance.instance_id
        ));
    }

    let mb_keys = (mem_mb * 1024 * 1024) / 128;
    if max_keys > mb_keys {
        return Err(format!(
            "rate-limit extension {} max_keys ({max_keys}) exceeds memory limit {mem_mb}MB ({mb_keys} keys)",
            instance.instance_id
        ));
    }

    let mut rule_ids = HashSet::with_capacity(rules.len());
    for (idx, r_val) in rules.iter().enumerate() {
        let r_obj = r_val.as_object().ok_or_else(|| {
            format!(
                "rate-limit extension {} rule #{idx} must be an object",
                instance.instance_id
            )
        })?;
        let id = r_obj.get("id").and_then(|v| v.as_str()).ok_or_else(|| {
            format!(
                "rate-limit extension {} rule #{idx} missing id",
                instance.instance_id
            )
        })?;
        if id.trim().is_empty() || id.len() > 128 || !rule_ids.insert(id.to_string()) {
            return Err(format!(
                "rate-limit extension {} invalid or duplicate rule id: {id}",
                instance.instance_id
            ));
        }
        let host = r_obj.get("host").and_then(|v| v.as_str()).ok_or_else(|| {
            format!(
                "rate-limit extension {} rule {id} missing host",
                instance.instance_id
            )
        })?;
        if host.is_empty() || host.len() > 253 {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid host",
                instance.instance_id
            ));
        }
        let path = r_obj
            .get("path_prefix")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "rate-limit extension {} rule {id} missing path_prefix",
                    instance.instance_id
                )
            })?;
        if !path.starts_with('/') || path.len() > 8192 || path.bytes().any(|b| b <= 32 || b >= 127)
        {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid path_prefix",
                instance.instance_id
            ));
        }
        let limit_by = r_obj
            .get("limit_by")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "rate-limit extension {} rule {id} missing limit_by",
                    instance.instance_id
                )
            })?;
        if !matches!(
            limit_by,
            "client_ip" | "api_key" | "authorization" | "route_path"
        ) {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid limit_by: {limit_by}",
                instance.instance_id
            ));
        }
        let rate = r_obj.get("rate").and_then(|v| v.as_u64()).ok_or_else(|| {
            format!(
                "rate-limit extension {} rule {id} missing rate",
                instance.instance_id
            )
        })?;
        if rate == 0 || rate > 1_000_000 {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid rate",
                instance.instance_id
            ));
        }
        let period = r_obj
            .get("period_secs")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| {
                format!(
                    "rate-limit extension {} rule {id} missing period_secs",
                    instance.instance_id
                )
            })?;
        if period == 0 || period > 86400 {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid period_secs",
                instance.instance_id
            ));
        }
        let action = r_obj
            .get("action_on_exceeded")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "rate-limit extension {} rule {id} missing action_on_exceeded",
                    instance.instance_id
                )
            })?;
        if !matches!(action, "throttle" | "block" | "audit" | "custom_response") {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid action_on_exceeded: {action}",
                instance.instance_id
            ));
        }
        if matches!(r_obj.get("burst").and_then(|v| v.as_u64()), Some(burst) if burst < rate) {
            return Err(format!(
                "rate-limit extension {} rule {id} burst cannot be less than rate ({rate})",
                instance.instance_id
            ));
        }
        if matches!(r_obj.get("rejected_code").and_then(|v| v.as_u64()), Some(rejected_code) if !(200..=599).contains(&rejected_code))
        {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid rejected_code",
                instance.instance_id
            ));
        }
    }

    Ok(())
}
