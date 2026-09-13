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
    if let Some(mode) = string(config, "mode") {
        if !matches!(mode, "local" | "distributed") {
            return Err(format!(
                "rate-limit extension {} has invalid mode: {mode} (must be 'local' or 'distributed')",
                instance.instance_id
            ));
        }
        if mode == "distributed" {
            if let Some(redis) = config.get("redis").and_then(Value::as_object) {
                let endpoint = redis.get("endpoint").and_then(Value::as_str).unwrap_or("");
                if endpoint.trim().is_empty() {
                    return Err(format!(
                        "rate-limit extension {} distributed mode requires non-empty redis.endpoint",
                        instance.instance_id
                    ));
                }
                if let Some(on_error) = redis.get("on_error").and_then(Value::as_str)
                    && !matches!(on_error, "fallback_local" | "pass" | "block")
                {
                    return Err(format!(
                        "rate-limit extension {} has invalid redis.on_error: {on_error}",
                        instance.instance_id
                    ));
                }
                if let Some(timeout_ms) = redis.get("timeout_ms").and_then(Value::as_u64)
                    && (timeout_ms == 0 || timeout_ms > 5000)
                {
                    return Err(format!(
                        "rate-limit extension {} redis.timeout_ms must be 1..=5000",
                        instance.instance_id
                    ));
                }
                if let Some(pool_size) = redis.get("pool_size").and_then(Value::as_u64)
                    && (pool_size == 0 || pool_size > 64)
                {
                    return Err(format!(
                        "rate-limit extension {} redis.pool_size must be 1..=64",
                        instance.instance_id
                    ));
                }
                if let Some(custom_lua) = redis.get("custom_lua_script").and_then(Value::as_str)
                    && (custom_lua.trim().is_empty() || custom_lua.len() > 65536)
                {
                    return Err(format!(
                        "rate-limit extension {} redis.custom_lua_script cannot be empty or exceed 64KB",
                        instance.instance_id
                    ));
                }
                if let Some(tls) = redis.get("tls").and_then(Value::as_object)
                    && let Some(ca) = tls.get("ca_cert_pem").and_then(Value::as_str)
                    && (ca.trim().is_empty() || ca.len() > 32768)
                {
                    return Err(format!(
                        "rate-limit extension {} redis.tls.ca_cert_pem cannot be empty or exceed 32KB",
                        instance.instance_id
                    ));
                }
            } else {
                return Err(format!(
                    "rate-limit extension {} in distributed mode requires a 'redis' config object",
                    instance.instance_id
                ));
            }
        }
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
            "client_ip" | "header" | "route_path"
        ) {
            return Err(format!(
                "rate-limit extension {} rule {id} invalid limit_by: {limit_by}",
                instance.instance_id
            ));
        }
        if limit_by == "header" {
            let header_name = r_obj
                .get("header_name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if header_name.trim().is_empty()
                || header_name.len() > 64
                || !header_name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                return Err(format!(
                    "rate-limit extension {} rule '{id}' limit_by 'header' requires valid header_name (1..=64 alphanumeric, '-' or '_')",
                    instance.instance_id
                ));
            }
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
        if let Some(msg) = r_obj.get("custom_message").and_then(|v| v.as_str())
            && msg.len() > 2048
        {
            return Err(format!(
                "rate-limit extension {} rule {id} custom_message exceeds 2048 bytes",
                instance.instance_id
            ));
        }
        if let Some(headers) = r_obj.get("response_headers").and_then(|v| v.as_array()) {
            if headers.len() > 8 {
                return Err(format!(
                    "rate-limit extension {} rule {id} response_headers exceeds maximum of 8 headers",
                    instance.instance_id
                ));
            }
            for (h_idx, h_val) in headers.iter().enumerate() {
                let h_obj = h_val.as_object().ok_or_else(|| {
                    format!(
                        "rate-limit extension {} rule {id} header #{h_idx} must be an object",
                        instance.instance_id
                    )
                })?;
                let name = h_obj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let value = h_obj.get("value").and_then(|v| v.as_str()).unwrap_or("");
                if name.trim().is_empty() || name.len() > 64 {
                    return Err(format!(
                        "rate-limit extension {} rule {id} header #{h_idx} name must be 1..=64 characters",
                        instance.instance_id
                    ));
                }
                if value.len() > 256 {
                    return Err(format!(
                        "rate-limit extension {} rule {id} header #{h_idx} value exceeds 256 characters",
                        instance.instance_id
                    ));
                }
            }
        }
    }

    Ok(())
}
