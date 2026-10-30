//! Extension Materialization Dispatcher.
//!
//! Delegates proxy directive generation to each respective extension in `aurora_extensions`,
//! and routes dataplane extensions directly to their Shared Memory (SHM) policy slots.

use aurora_engine::shm::{
    AURORA_EXT_BLUE_GREEN, AURORA_EXT_CANARY_RELEASE, AURORA_EXT_CONN_LIMIT,
    AURORA_EXT_IP_RESTRICTION, AURORA_EXT_JWT, AURORA_EXT_RATE_LIMIT, AURORA_EXT_REQUEST_MIRROR,
    AURORA_EXT_REQUEST_TERMINATION, AURORA_EXT_RESOURCE_LIMIT, AURORA_EXT_RESPONSE_CACHE,
    AURORA_EXT_RESPONSE_COMPRESSION, AURORA_EXT_TRAFFIC_SHAPER, AURORA_EXT_TRAFFIC_SPLIT,
    AURORA_SLOT_ROUTE_MASKS, RouteMaskRule, RouteMaskSnapshot,
};
use super::route::RoutingSpec;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtensionInstanceSpec {
    pub instance_id: String,
    pub key: String,
    pub version: u32,
    #[serde(default)]
    pub renderer: String,
    #[serde(default)]
    pub manifest_digest: String,
    pub config_json: String,
}

#[derive(Debug, Default)]
pub struct RenderedExtensions {
    pub modules_conf: String,
    pub http_conf: String,
    pub server_conf: String,
    pub shm_slots: Vec<(u32, Vec<u8>)>,
}

impl RenderedExtensions {
    pub fn get_shm_slot(&self, slot_id: u32) -> Option<&[u8]> {
        self.shm_slots
            .iter()
            .find(|(slot, _)| *slot == slot_id)
            .map(|(_, data)| data.as_slice())
    }

    pub fn get_shm_slot_json(&self, slot_id: u32) -> Option<Value> {
        self.get_shm_slot(slot_id)
            .and_then(|bytes| serde_json::from_slice(bytes).ok())
    }
}

pub fn resolve_dataplane_shm_slot(renderer: &str) -> Option<u32> {
    match renderer {
        "ip-restriction" => Some(AURORA_EXT_IP_RESTRICTION),
        "engine-jwt-rs256" => Some(AURORA_EXT_JWT),
        "rate-limit" => Some(AURORA_EXT_RATE_LIMIT),
        "connection-limit" => Some(AURORA_EXT_CONN_LIMIT),
        "traffic-shaper" => Some(AURORA_EXT_TRAFFIC_SHAPER),
        "resource-limit" => Some(AURORA_EXT_RESOURCE_LIMIT),
        "traffic-split" => Some(AURORA_EXT_TRAFFIC_SPLIT),
        "canary-release" => Some(AURORA_EXT_CANARY_RELEASE),
        "blue-green" => Some(AURORA_EXT_BLUE_GREEN),
        "request-mirror" => Some(AURORA_EXT_REQUEST_MIRROR),
        "request-termination" => Some(AURORA_EXT_REQUEST_TERMINATION),
        "response-compression" | "compression-gzip" => Some(AURORA_EXT_RESPONSE_COMPRESSION),
        "response-cache" => Some(AURORA_EXT_RESPONSE_CACHE),
        _ => None,
    }
}

/// Resolves an extension key or alias inside a Route's `plugins_json` to its SHM slot ID.
pub fn resolve_extension_key_slot(key: &str) -> Option<u32> {
    let clean = key.trim().strip_prefix("builtin/").unwrap_or(key.trim());
    match clean {
        "ip-restriction" | "ip_restriction" => Some(AURORA_EXT_IP_RESTRICTION),
        "jwt-authentication" | "jwt_authentication" | "engine-jwt-rs256" | "jwt" => {
            Some(AURORA_EXT_JWT)
        }
        "rate-limit" | "rate_limit" => Some(AURORA_EXT_RATE_LIMIT),
        "connection-limit" | "connection_limit" => Some(AURORA_EXT_CONN_LIMIT),
        "traffic-shaper" | "traffic_shaper" => Some(AURORA_EXT_TRAFFIC_SHAPER),
        "resource-limit" | "resource_limit" => Some(AURORA_EXT_RESOURCE_LIMIT),
        "traffic-split" | "traffic_split" => Some(AURORA_EXT_TRAFFIC_SPLIT),
        "canary-release" | "canary_release" => Some(AURORA_EXT_CANARY_RELEASE),
        "blue-green" | "blue_green" => Some(AURORA_EXT_BLUE_GREEN),
        "request-mirror" | "request_mirror" => Some(AURORA_EXT_REQUEST_MIRROR),
        "request-termination" | "request_termination" => Some(AURORA_EXT_REQUEST_TERMINATION),
        "response-compression" | "response_compression" | "compression-gzip" => {
            Some(AURORA_EXT_RESPONSE_COMPRESSION)
        }
        "response-cache" | "response_cache" => Some(AURORA_EXT_RESPONSE_CACHE),
        _ => None,
    }
}

/// Compiles per-route extension bitmasks and route-level overrides from `RoutingSpec`
/// directly into `RenderedExtensions.shm_slots`.
pub fn compile_route_masks_into_shm(routing: &RoutingSpec, rendered: &mut RenderedExtensions) {
    let mut all_locs: Vec<(i32, String, Option<String>)> = Vec::new();
    for domain in &routing.domains {
        for loc in &domain.locations {
            let clean_path = if loc.path.trim().is_empty() {
                "/".to_string()
            } else {
                loc.path.trim().to_string()
            };
            all_locs.push((loc.priority, clean_path, loc.plugins_json.clone()));
        }
    }

    if all_locs.is_empty() {
        return;
    }

    // Sort ascending by priority so higher-priority routes overwrite or appear last at the same path
    all_locs.sort_by_key(|(prio, _, _)| *prio);

    let mut rules: Vec<RouteMaskRule> = Vec::with_capacity(all_locs.len());
    let mut cache_overrides: Vec<Value> = Vec::new();
    let mut compression_overrides: Vec<Value> = Vec::new();
    let mut rate_limit_rules: Vec<Value> = Vec::new();
    let mut conn_limit_rules: Vec<Value> = Vec::new();
    let mut ip_restriction_rules: Vec<Value> = Vec::new();

    // Extract custom profile maps from each extension's SHM slot JSON
    let mut ext_profiles: std::collections::HashMap<u32, serde_json::Map<String, Value>> =
        std::collections::HashMap::new();
    for (slot_id, slot_bytes) in &rendered.shm_slots {
        if let Ok(Value::Object(obj)) = serde_json::from_slice::<Value>(slot_bytes)
            && let Some(Value::Object(profiles)) = obj.get("profiles")
        {
            ext_profiles.insert(*slot_id, profiles.clone());
        }
    }

    for (_, path, plugins_json_opt) in all_locs {
        let mut allow_mask: u32 = 0;
        let mut deny_mask: u32 = 0;
        let mut explicit = false;

        if let Some(raw_json) = plugins_json_opt.as_deref() {
            let trimmed = raw_json.trim();
            if !trimmed.is_empty()
                && trimmed != "{}"
                && let Ok(Value::Object(map)) = serde_json::from_str::<Value>(trimmed)
            {
                if let Some(profile) = map.get("_profile").and_then(|v| v.as_str()) {
                    match profile {
                        "passthrough" | "raw" => {
                            explicit = true;
                            allow_mask = 0;
                            deny_mask = u32::MAX;
                        }
                        "public_cache" => {
                            explicit = true;
                            allow_mask = (1 << AURORA_EXT_RESPONSE_CACHE)
                                | (1 << AURORA_EXT_RESPONSE_COMPRESSION)
                                | (1 << AURORA_EXT_RATE_LIMIT);
                        }
                        "protected_api" => {
                            explicit = true;
                            allow_mask = (1 << AURORA_EXT_JWT)
                                | (1 << AURORA_EXT_RATE_LIMIT)
                                | (1 << AURORA_EXT_RESPONSE_COMPRESSION);
                        }
                        "strict_security" => {
                            explicit = true;
                            allow_mask = (1 << AURORA_EXT_IP_RESTRICTION)
                                | (1 << AURORA_EXT_JWT)
                                | (1 << AURORA_EXT_RATE_LIMIT)
                                | (1 << AURORA_EXT_CONN_LIMIT)
                                | (1 << AURORA_EXT_RESOURCE_LIMIT);
                        }
                        "custom" => {
                            explicit = true;
                        }
                        _ => {}
                    }
                }

                let explicit_mode_override = map.get("_mode").and_then(|v| v.as_str());
                if let Some(mode) = explicit_mode_override {
                    match mode {
                        "explicit" => explicit = true,
                        "inherit" => explicit = false,
                        _ => {}
                    }
                }

                for (k, v) in &map {
                    if k.starts_with('_') {
                        continue;
                    }
                    if let Some(slot_id) = resolve_extension_key_slot(k) {
                        // Determine whether this extension is enabled and which profile name is selected
                        let (is_enabled, profile_name_opt) = if let Some(b) = v.as_bool() {
                            (Some(b), if b { Some("default") } else { None })
                        } else if let Some(s) = v.as_str() {
                            let s_trim = s.trim();
                            if s_trim.is_empty()
                                || s_trim.eq_ignore_ascii_case("off")
                                || s_trim.eq_ignore_ascii_case("disabled")
                                || s_trim.eq_ignore_ascii_case("none")
                            {
                                (Some(false), None)
                            } else {
                                if explicit_mode_override != Some("inherit") {
                                    explicit = true;
                                }
                                (Some(true), Some(s_trim))
                            }
                        } else if let Some(obj) = v.as_object() {
                            let prof_str = obj.get("profile").and_then(|p| p.as_str()).map(str::trim);
                            if prof_str.is_some() && explicit_mode_override != Some("inherit") {
                                explicit = true;
                            }
                            let disabled_by_prof = matches!(
                                prof_str,
                                Some(p) if p.is_empty()
                                    || p.eq_ignore_ascii_case("off")
                                    || p.eq_ignore_ascii_case("disabled")
                                    || p.eq_ignore_ascii_case("none")
                            );
                            let en = if disabled_by_prof {
                                false
                            } else {
                                obj.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true)
                            };
                            (Some(en), if en { Some(prof_str.unwrap_or("default")) } else { None })
                        } else {
                            (None, None)
                        };

                        match is_enabled {
                            Some(true) => {
                                allow_mask |= 1 << slot_id;
                                deny_mask &= !(1 << slot_id);
                            }
                            Some(false) => {
                                deny_mask |= 1 << slot_id;
                                allow_mask &= !(1 << slot_id);
                            }
                            None => {}
                        }

                        // Resolve profile object from extension's `config.profiles[profile_name]`
                        let custom_prof_obj = profile_name_opt.and_then(|pname| {
                            ext_profiles
                                .get(&slot_id)
                                .and_then(|pmap| pmap.get(pname))
                                .and_then(|pval| pval.as_object())
                        });
                        let inline_obj = v.as_object();

                        if slot_id == AURORA_EXT_RESPONSE_CACHE {
                            if let Some(prof_name) = profile_name_opt {
                                let builtin_ttl = match prof_name {
                                    "short_ttl" => Some(30u32),
                                    "medium_ttl" => Some(120u32),
                                    "long_static" => Some(3600u32),
                                    _ => None,
                                };
                                let ttl_opt = inline_obj
                                    .and_then(|o| o.get("ttl_secs"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("ttl_secs")))
                                    .and_then(|t| t.as_u64())
                                    .map(|t| t as u32)
                                    .or(builtin_ttl);
                                let headers_opt = inline_obj
                                    .and_then(|o| o.get("cache_key_headers"))
                                    .or_else(|| {
                                        custom_prof_obj.and_then(|o| o.get("cache_key_headers"))
                                    })
                                    .and_then(|arr| arr.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|x| x.as_str().map(String::from))
                                            .collect::<Vec<_>>()
                                    });
                                if ttl_opt.is_some()
                                    || headers_opt.is_some()
                                    || prof_name != "default"
                                {
                                    let mut entry = serde_json::Map::new();
                                    entry.insert("path_prefix".to_string(), Value::String(path.clone()));
                                    entry.insert("enabled".to_string(), Value::Bool(true));
                                    if let Some(ttl) = ttl_opt {
                                        entry.insert("ttl_secs".to_string(), Value::Number(ttl.into()));
                                    }
                                    if let Some(hdrs) = headers_opt {
                                        entry.insert(
                                            "cache_key_headers".to_string(),
                                            Value::Array(hdrs.into_iter().map(Value::String).collect()),
                                        );
                                    }
                                    cache_overrides.push(Value::Object(entry));
                                }
                            } else if is_enabled == Some(false) && inline_obj.is_some() {
                                cache_overrides.push(serde_json::json!({
                                    "path_prefix": path,
                                    "enabled": false
                                }));
                            }
                        } else if slot_id == AURORA_EXT_RESPONSE_COMPRESSION {
                            if let Some(prof_name) = profile_name_opt {
                                let (builtin_min_len, builtin_algos): (
                                    Option<u64>,
                                    Option<Vec<String>>,
                                ) = match prof_name {
                                    "fast_zstd" => (
                                        Some(256),
                                        Some(vec!["zstd".to_string(), "gzip".to_string()]),
                                    ),
                                    "max_ratio" => (
                                        Some(512),
                                        Some(vec![
                                            "br".to_string(),
                                            "zstd".to_string(),
                                            "gzip".to_string(),
                                        ]),
                                    ),
                                    "large_payloads" => (
                                        Some(4096),
                                        Some(vec![
                                            "zstd".to_string(),
                                            "br".to_string(),
                                            "gzip".to_string(),
                                        ]),
                                    ),
                                    _ => (None, None),
                                };
                                let min_len = inline_obj
                                    .and_then(|o| o.get("min_length"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("min_length")))
                                    .and_then(|m| m.as_u64())
                                    .or(builtin_min_len);
                                let algos = inline_obj
                                    .and_then(|o| o.get("prefer_algorithms"))
                                    .or_else(|| {
                                        custom_prof_obj.and_then(|o| o.get("prefer_algorithms"))
                                    })
                                    .and_then(|arr| arr.as_array())
                                    .map(|arr| {
                                        arr.iter()
                                            .filter_map(|x| x.as_str().map(String::from))
                                            .collect::<Vec<_>>()
                                    })
                                    .or(builtin_algos);
                                if min_len.is_some() || algos.is_some() {
                                    let mut entry = serde_json::Map::new();
                                    entry.insert("path_prefix".to_string(), Value::String(path.clone()));
                                    entry.insert("enabled".to_string(), Value::Bool(true));
                                    if let Some(ml) = min_len {
                                        entry.insert("min_length".to_string(), Value::Number(ml.into()));
                                    }
                                    if let Some(a) = algos {
                                        entry.insert(
                                            "prefer_algorithms".to_string(),
                                            Value::Array(a.into_iter().map(Value::String).collect()),
                                        );
                                    }
                                    compression_overrides.push(Value::Object(entry));
                                }
                            }
                        } else if slot_id == AURORA_EXT_RATE_LIMIT {
                            if let Some(prof_name) = profile_name_opt {
                                let (def_rate, def_period, def_burst) = match prof_name {
                                    "strict" => (10u64, 1u64, 20u64),
                                    "high_throughput" => (1000u64, 1u64, 2000u64),
                                    "burst_tolerant" => (250u64, 1u64, 1000u64),
                                    _ => (100u64, 1u64, 200u64),
                                };
                                let rate = inline_obj
                                    .and_then(|o| o.get("rate"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("rate")))
                                    .and_then(|x| x.as_u64())
                                    .unwrap_or(def_rate);
                                let period_secs = inline_obj
                                    .and_then(|o| o.get("period_secs"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("period_secs")))
                                    .and_then(|x| x.as_u64())
                                    .unwrap_or(def_period);
                                let burst = inline_obj
                                    .and_then(|o| o.get("burst"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("burst")))
                                    .and_then(|x| x.as_u64())
                                    .unwrap_or(def_burst);
                                let limit_by = inline_obj
                                    .and_then(|o| o.get("limit_by"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("limit_by")))
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("client_ip");
                                let action = inline_obj
                                    .and_then(|o| o.get("action_on_exceeded"))
                                    .or_else(|| {
                                        custom_prof_obj.and_then(|o| o.get("action_on_exceeded"))
                                    })
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("throttle");

                                if prof_name != "default"
                                    || custom_prof_obj.is_some()
                                    || inline_obj.and_then(|o| o.get("rate")).is_some()
                                {
                                    rate_limit_rules.push(serde_json::json!({
                                        "id": format!("route:{path}:{prof_name}"),
                                        "priority": 100,
                                        "host": "*",
                                        "path_prefix": path,
                                        "limit_by": limit_by,
                                        "rate": rate,
                                        "period_secs": period_secs,
                                        "burst": burst,
                                        "action_on_exceeded": action
                                    }));
                                }
                            }
                        } else if slot_id == AURORA_EXT_CONN_LIMIT {
                            if let Some(prof_name) = profile_name_opt {
                                let def_max_conn = match prof_name {
                                    "strict" => 20u64,
                                    "high_concurrency" => 500u64,
                                    _ => 100u64,
                                };
                                let max_conn = inline_obj
                                    .and_then(|o| o.get("max_connections"))
                                    .or_else(|| {
                                        custom_prof_obj.and_then(|o| o.get("max_connections"))
                                    })
                                    .and_then(|x| x.as_u64())
                                    .unwrap_or(def_max_conn);
                                let limit_by = inline_obj
                                    .and_then(|o| o.get("limit_by"))
                                    .or_else(|| custom_prof_obj.and_then(|o| o.get("limit_by")))
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("client_ip");
                                let action = inline_obj
                                    .and_then(|o| o.get("action_on_exceeded"))
                                    .or_else(|| {
                                        custom_prof_obj.and_then(|o| o.get("action_on_exceeded"))
                                    })
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("throttle");

                                if prof_name != "default"
                                    || custom_prof_obj.is_some()
                                    || inline_obj.and_then(|o| o.get("max_connections")).is_some()
                                {
                                    conn_limit_rules.push(serde_json::json!({
                                        "id": format!("route:{path}:{prof_name}"),
                                        "priority": 100,
                                        "host": "*",
                                        "path_prefix": path,
                                        "limit_by": limit_by,
                                        "max_connections": max_conn,
                                        "action_on_exceeded": action
                                    }));
                                }
                            }
                        } else if slot_id == AURORA_EXT_IP_RESTRICTION
                            && let Some(prof_name) = profile_name_opt
                        {
                            let builtin_nets: Option<Vec<String>> = match prof_name {
                                "internal_only" => Some(vec![
                                    "10.0.0.0/8".to_string(),
                                    "172.16.0.0/12".to_string(),
                                    "192.168.0.0/16".to_string(),
                                    "127.0.0.1/32".to_string(),
                                ]),
                                _ => None,
                            };
                            let networks = inline_obj
                                .and_then(|o| o.get("networks"))
                                .or_else(|| custom_prof_obj.and_then(|o| o.get("networks")))
                                .and_then(|arr| arr.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|x| x.as_str().map(String::from))
                                        .collect::<Vec<_>>()
                                })
                                .or(builtin_nets);
                            let action = inline_obj
                                .and_then(|o| o.get("action"))
                                .or_else(|| custom_prof_obj.and_then(|o| o.get("action")))
                                .and_then(|x| x.as_str())
                                .unwrap_or("allow");

                            if let Some(nets) = networks {
                                ip_restriction_rules.push(serde_json::json!({
                                    "id": format!("route:{path}:{prof_name}"),
                                    "priority": 100,
                                    "enabled": true,
                                    "host": "*",
                                    "path_prefix": path,
                                    "action": action,
                                    "networks": nets
                                }));
                            }
                        }
                    }
                }
            }
        }

        if let Some(existing) = rules.iter_mut().find(|r| r.path == path) {
            existing.allow_mask = allow_mask;
            existing.deny_mask = deny_mask;
            existing.explicit = explicit;
        } else {
            rules.push(RouteMaskRule {
                path,
                allow_mask,
                deny_mask,
                explicit,
            });
        }
    }

    // 1. Merge route-level cache overrides into AURORA_EXT_RESPONSE_CACHE SHM slot
    if !cache_overrides.is_empty()
        && let Some((_, slot_bytes)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_EXT_RESPONSE_CACHE)
        && let Ok(mut cache_val) = serde_json::from_slice::<Value>(slot_bytes)
        && let Some(cache_obj) = cache_val.as_object_mut()
    {
        let overrides_arr = cache_obj
            .entry("routes_override")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = overrides_arr.as_array_mut() {
            for entry in cache_overrides {
                let path_prefix = entry.get("path_prefix").and_then(|p| p.as_str());
                if !arr.iter().any(|item| {
                    item.get("path_prefix").and_then(|p| p.as_str()) == path_prefix
                }) {
                    arr.push(entry);
                }
            }
            if let Ok(updated_bytes) = serde_json::to_vec(&cache_val) {
                *slot_bytes = updated_bytes;
            }
        }
    }

    // 2. Merge route-level compression overrides into AURORA_EXT_RESPONSE_COMPRESSION SHM slot
    if !compression_overrides.is_empty()
        && let Some((_, slot_bytes)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_EXT_RESPONSE_COMPRESSION)
        && let Ok(mut comp_val) = serde_json::from_slice::<Value>(slot_bytes)
        && let Some(comp_obj) = comp_val.as_object_mut()
    {
        let overrides_arr = comp_obj
            .entry("routes_override")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = overrides_arr.as_array_mut() {
            for entry in compression_overrides {
                let path_prefix = entry.get("path_prefix").and_then(|p| p.as_str());
                if !arr.iter().any(|item| {
                    item.get("path_prefix").and_then(|p| p.as_str()) == path_prefix
                }) {
                    arr.push(entry);
                }
            }
            if let Ok(updated_bytes) = serde_json::to_vec(&comp_val) {
                *slot_bytes = updated_bytes;
            }
        }
    }

    // 3. Merge route-level rate-limit rules into AURORA_EXT_RATE_LIMIT SHM slot
    if !rate_limit_rules.is_empty()
        && let Some((_, slot_bytes)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_EXT_RATE_LIMIT)
        && let Ok(mut rl_val) = serde_json::from_slice::<Value>(slot_bytes)
        && let Some(rl_obj) = rl_val.as_object_mut()
    {
        let rules_arr = rl_obj
            .entry("rules")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = rules_arr.as_array_mut() {
            for rule in rate_limit_rules {
                let path_prefix = rule.get("path_prefix").and_then(|p| p.as_str());
                if !arr.iter().any(|item| {
                    item.get("path_prefix").and_then(|p| p.as_str()) == path_prefix
                }) {
                    arr.push(rule);
                }
            }
            if let Ok(updated_bytes) = serde_json::to_vec(&rl_val) {
                *slot_bytes = updated_bytes;
            }
        }
    }

    // 4. Merge route-level connection-limit rules into AURORA_EXT_CONN_LIMIT SHM slot
    if !conn_limit_rules.is_empty()
        && let Some((_, slot_bytes)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_EXT_CONN_LIMIT)
        && let Ok(mut cl_val) = serde_json::from_slice::<Value>(slot_bytes)
        && let Some(cl_obj) = cl_val.as_object_mut()
    {
        let rules_arr = cl_obj
            .entry("rules")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = rules_arr.as_array_mut() {
            for rule in conn_limit_rules {
                let path_prefix = rule.get("path_prefix").and_then(|p| p.as_str());
                if !arr.iter().any(|item| {
                    item.get("path_prefix").and_then(|p| p.as_str()) == path_prefix
                }) {
                    arr.push(rule);
                }
            }
            if let Ok(updated_bytes) = serde_json::to_vec(&cl_val) {
                *slot_bytes = updated_bytes;
            }
        }
    }

    // 5. Merge route-level IP restriction rules into AURORA_EXT_IP_RESTRICTION SHM slot
    if !ip_restriction_rules.is_empty()
        && let Some((_, slot_bytes)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_EXT_IP_RESTRICTION)
        && let Ok(mut ip_val) = serde_json::from_slice::<Value>(slot_bytes)
        && let Some(ip_obj) = ip_val.as_object_mut()
    {
        let rules_arr = ip_obj
            .entry("rules")
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(arr) = rules_arr.as_array_mut() {
            for rule in ip_restriction_rules {
                let path_prefix = rule.get("path_prefix").and_then(|p| p.as_str());
                if !arr.iter().any(|item| {
                    item.get("path_prefix").and_then(|p| p.as_str()) == path_prefix
                }) {
                    arr.push(rule);
                }
            }
            if let Ok(updated_bytes) = serde_json::to_vec(&ip_val) {
                *slot_bytes = updated_bytes;
            }
        }
    }

    let snapshot = RouteMaskSnapshot { routes: rules };
    if let Ok(bytes) = serde_json::to_vec(&snapshot) {
        if let Some((_, existing)) = rendered
            .shm_slots
            .iter_mut()
            .find(|(s, _)| *s == AURORA_SLOT_ROUTE_MASKS)
        {
            *existing = bytes;
        } else {
            rendered.shm_slots.push((AURORA_SLOT_ROUTE_MASKS, bytes));
        }
    }
}

pub fn render_extensions(
    instances: &[ExtensionInstanceSpec],
) -> Result<RenderedExtensions, String> {
    let modules = String::from(
        "# Generated by Aurora Control Worker for dynamic extension modules\n# No dynamic modules loaded\n",
    );
    let mut http =
        String::from("# Generated by Aurora Control Worker for HTTP-level extension directives\n");
    let mut ingress_server = String::new();
    let mut regular_server = String::new();
    let mut has_http = false;
    let mut has_server = false;
    let mut shm_slots = Vec::new();
    let mut metrics_instances = 0;
    let mut opentelemetry_metrics_instances = 0;
    let mut opentelemetry_logs_instances = 0;
    let mut opentelemetry_tracing_instances = 0;
    let mut std_log_instances = 0;

    for instance in instances {
        if instance.renderer.trim().is_empty() {
            return Err(format!(
                "extension instance {} has empty renderer",
                instance.instance_id
            ));
        }

        // 1. Dataplane SHM Extensions (zero-overhead envelope)
        if let Some(slot_id) = resolve_dataplane_shm_slot(&instance.renderer) {
            if shm_slots.iter().any(|(s, _)| *s == slot_id) {
                return Err(format!(
                    "NodeSpec contains more than one {} extension",
                    instance.renderer
                ));
            }

            let val: Value = serde_json::from_str(&instance.config_json).map_err(|error| {
                format!(
                    "decode extension instance {} config: {error}",
                    instance.instance_id
                )
            })?;
            if !val.is_object() {
                return Err(format!(
                    "extension instance {} config must be an object",
                    instance.instance_id
                ));
            }

            shm_slots.push((slot_id, instance.config_json.as_bytes().to_vec()));
            continue;
        }

        // 2. NGINX-level Extensions (delegated directly to each extension's own materialize)
        let config = serde_json::from_str::<Value>(&instance.config_json)
            .map_err(|error| {
                format!(
                    "decode extension instance {} config: {error}",
                    instance.instance_id
                )
            })?
            .as_object()
            .cloned()
            .ok_or_else(|| {
                format!(
                    "extension instance {} config must be an object",
                    instance.instance_id
                )
            })?;

        match instance.renderer.as_str() {
            "agent-metrics" | "prometheus" => {
                aurora_extensions::prometheus::materialize::materialize(
                    &instance.instance_id,
                    &config,
                    &mut http,
                    &mut has_http,
                    &mut metrics_instances,
                )?;
            }
            "opentelemetry-metrics" => {
                opentelemetry_metrics_instances += 1;
                if opentelemetry_metrics_instances > 1 {
                    return Err(
                        "NodeSpec contains more than one opentelemetry-metrics extension"
                            .to_string(),
                    );
                }
            }
            "opentelemetry-logs" => {
                opentelemetry_logs_instances += 1;
                if opentelemetry_logs_instances > 1 {
                    return Err(
                        "NodeSpec contains more than one opentelemetry-logs extension".to_string(),
                    );
                }
            }
            "opentelemetry-tracing" => {
                opentelemetry_tracing_instances += 1;
                if opentelemetry_tracing_instances > 1 {
                    return Err(
                        "NodeSpec contains more than one opentelemetry-tracing extension"
                            .to_string(),
                    );
                }
            }
            "std-log" => {
                std_log_instances += 1;
                if std_log_instances > 1 {
                    return Err("NodeSpec contains more than one std-log extension".to_string());
                }
                aurora_extensions::std_log::materialize::materialize(
                    &config,
                    &mut regular_server,
                    &mut has_server,
                )?;
            }
            "correlation-id" => {
                aurora_extensions::correlation_id::materialize(&config, &mut regular_server, &mut has_server)?
            }
            "cors" => aurora_extensions::cors::materialize(&config, &mut regular_server, &mut has_server)?,
            "request-header-transform" => aurora_extensions::request_header_transform::materialize(
                &config,
                &mut ingress_server,
                &mut has_server,
            )?,
            "response-header-transform" => aurora_extensions::response_header_transform::materialize(
                &config,
                &mut regular_server,
                &mut has_server,
            )?,
            "uri-rewrite" => {}
            "response-buffering" => {
                aurora_extensions::response_buffering::materialize(&mut regular_server, &mut has_server)?
            }
            "timeout-policy" => {
                aurora_extensions::timeout_policy::materialize(&config, &mut regular_server, &mut has_server)?
            }
            "maintenance" => {
                aurora_extensions::maintenance::materialize(&config, &mut regular_server, &mut has_server)?
            }
            renderer => {
                return Err(format!(
                    "extension instance {} uses unsupported renderer {renderer}",
                    instance.instance_id
                ));
            }
        }
    }

    let mut server = String::from("# Generated by Aurora Control Worker for active extensions\n");
    if !ingress_server.is_empty() {
        server.push_str(&ingress_server);
    }
    server.push_str(&regular_server);

    if !has_http {
        http.push_str("# No active HTTP-level extension directives\n");
    }
    if !has_server {
        server.push_str("# No active NGINX-level extension directives\n");
    }
    Ok(RenderedExtensions {
        modules_conf: modules,
        http_conf: http,
        server_conf: server,
        shm_slots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_extensions_correlation_id() {
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "corr-1".to_string(),
            key: "builtin/correlation-id".to_string(),
            version: 1,
            renderer: "correlation-id".to_string(),
            manifest_digest: String::new(),
            config_json: serde_json::json!({
                "request_id": {
                    "enabled": true,
                    "header_name": "X-Request-ID",
                    "send_in_response": true,
                    "include_in_access_log": true
                },
                "trace_id": {
                    "enabled": true,
                    "header_name": "traceparent",
                    "send_in_response": false,
                    "include_in_access_log": true
                }
            })
            .to_string(),
        }];

        let rendered = render_extensions(&instances).expect("render must succeed");
        assert!(rendered.server_conf.contains("set $aurora_req_id $request_id;"));
        assert!(rendered.server_conf.contains("proxy_set_header X-Request-ID $request_id;"));
        assert!(rendered.server_conf.contains("add_header X-Request-ID $request_id always;"));
        assert!(rendered.server_conf.contains("proxy_set_header traceparent \"00-$request_id-$aurora_span_id-01\";"));
    }

    #[test]
    fn test_render_extensions_prometheus_dynamic_port_and_allowlist() {
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "prom-1".to_string(),
            key: "builtin/prometheus".to_string(),
            version: 1,
            renderer: "agent-metrics".to_string(),
            manifest_digest: String::new(),
            config_json: serde_json::json!({
                "port": 9145,
                "allowlist": ["127.0.0.1", "10.0.0.0/8"]
            })
            .to_string(),
        }];

        let rendered = render_extensions(&instances).expect("render must succeed");
        assert!(rendered.http_conf.contains("listen 9145;"));
        assert!(rendered.http_conf.contains("allow 10.0.0.0/8;"));
        assert!(rendered.http_conf.contains("allow 127.0.0.1;"));
        assert!(rendered.http_conf.contains("deny all;"));
        assert!(rendered.http_conf.contains("location = /metrics {"));
        assert!(rendered.http_conf.contains("gateway_metrics;"));
    }

    #[test]
    fn test_render_extensions_response_compression_shm() {
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "comp-1".to_string(),
            key: "builtin/response-compression".to_string(),
            version: 1,
            renderer: "response-compression".to_string(),
            manifest_digest: String::new(),
            config_json: serde_json::json!({
                "enabled": true,
                "min_length": 512,
                "prefer_algorithms": ["zstd", "br", "gzip"]
            })
            .to_string(),
        }];

        let rendered = render_extensions(&instances).expect("render must succeed");
        // NGINX server block remains pure listener/proxy, zero compression directives!
        assert!(!rendered.server_conf.contains("gzip on;"));
        assert!(!rendered.server_conf.contains("gzip_types"));

        // Dataplane SHM slot contains the serialized config
        let slot = rendered.get_shm_slot(AURORA_EXT_RESPONSE_COMPRESSION);
        assert!(slot.is_some());
        let val = rendered.get_shm_slot_json(AURORA_EXT_RESPONSE_COMPRESSION).unwrap();
        assert_eq!(val["min_length"], 512);
    }

    #[test]
    fn test_render_extensions_response_compression_duplicate_rejected() {
        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "comp-1".to_string(),
                key: "builtin/response-compression".to_string(),
                version: 1,
                renderer: "response-compression".to_string(),
                manifest_digest: String::new(),
                config_json: "{}".to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "comp-2".to_string(),
                key: "builtin/response-compression".to_string(),
                version: 1,
                renderer: "response-compression".to_string(),
                manifest_digest: String::new(),
                config_json: "{}".to_string(),
            },
        ];

        let err = render_extensions(&instances).expect_err("duplicate response-compression should fail");
        assert!(err.contains("NodeSpec contains more than one response-compression extension"));
    }

    #[test]
    fn test_compile_route_masks_and_cache_overrides() {
        use super::super::route::{DomainRoutingSpec, LocationRoutingSpec, RoutingSpec};

        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "cache-1".to_string(),
                key: "builtin/response-cache".to_string(),
                version: 1,
                renderer: "response-cache".to_string(),
                manifest_digest: String::new(),
                config_json: serde_json::json!({
                    "enabled": true,
                    "default_ttl_secs": 300
                })
                .to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "comp-1".to_string(),
                key: "builtin/response-compression".to_string(),
                version: 1,
                renderer: "response-compression".to_string(),
                manifest_digest: String::new(),
                config_json: serde_json::json!({
                    "enabled": true
                })
                .to_string(),
            },
        ];

        let mut rendered = render_extensions(&instances).expect("render must succeed");
        let routing = RoutingSpec {
            domains: vec![DomainRoutingSpec {
                host: "api.aurora.local".to_string(),
                locations: vec![
                    LocationRoutingSpec {
                        path: "/api/v1/12kb".to_string(),
                        upstream: "app_blue".to_string(),
                        strip_path: true,
                        websocket: false,
                        priority: 10,
                        plugins_json: Some(
                            serde_json::json!({
                                "_profile": "public_cache",
                                "response-cache": { "enabled": true, "ttl_secs": 60 }
                            })
                            .to_string(),
                        ),
                        origin_tls: None,
                    },
                    LocationRoutingSpec {
                        path: "/api/v1/webhook".to_string(),
                        upstream: "app_blue".to_string(),
                        strip_path: false,
                        websocket: false,
                        priority: 20,
                        plugins_json: Some(
                            serde_json::json!({
                                "_profile": "passthrough"
                            })
                            .to_string(),
                        ),
                        origin_tls: None,
                    },
                ],
            }],
        };

        compile_route_masks_into_shm(&routing, &mut rendered);

        let mask_bytes = rendered
            .get_shm_slot(AURORA_SLOT_ROUTE_MASKS)
            .expect("route masks slot must exist");
        let snap: RouteMaskSnapshot = serde_json::from_slice(mask_bytes).unwrap();
        assert_eq!(snap.routes.len(), 2);

        let r1 = snap.routes.iter().find(|r| r.path == "/api/v1/12kb").unwrap();
        assert!(r1.explicit);
        assert_ne!(r1.allow_mask & (1 << AURORA_EXT_RESPONSE_CACHE), 0);
        assert_ne!(r1.allow_mask & (1 << AURORA_EXT_RESPONSE_COMPRESSION), 0);
        assert_eq!(r1.allow_mask & (1 << AURORA_EXT_JWT), 0);

        let r2 = snap.routes.iter().find(|r| r.path == "/api/v1/webhook").unwrap();
        assert!(r2.explicit);
        assert_eq!(r2.allow_mask, 0);

        // Verify route-level ttl_secs was merged into response-cache slot
        let cache_val = rendered.get_shm_slot_json(AURORA_EXT_RESPONSE_CACHE).unwrap();
        let overrides = cache_val["routes_override"].as_array().unwrap();
        assert_eq!(overrides.len(), 1);
        assert_eq!(overrides[0]["path_prefix"], "/api/v1/12kb");
        assert_eq!(overrides[0]["ttl_secs"], 60);
    }

    #[test]
    fn test_per_extension_profiles_resolve_and_materialize_into_shm() {
        use super::super::route::{DomainRoutingSpec, LocationRoutingSpec, RoutingSpec};

        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "ext-cache".to_string(),
                key: "builtin/response-cache".to_string(),
                version: 1,
                renderer: "response-cache".to_string(),
                manifest_digest: "abc".to_string(),
                config_json: serde_json::json!({
                    "enabled": true,
                    "default_ttl_secs": 300,
                    "profiles": {
                        "vip_cache": {
                            "label": "VIP 600s Cache",
                            "ttl_secs": 600,
                            "cache_key_headers": ["X-Tenant-ID"]
                        }
                    },
                    "routes_override": []
                })
                .to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "ext-rl".to_string(),
                key: "builtin/rate-limit".to_string(),
                version: 1,
                renderer: "rate-limit".to_string(),
                manifest_digest: "abc".to_string(),
                config_json: serde_json::json!({
                    "mode": "local",
                    "algorithm": "token_bucket",
                    "memory_size_mb": 16,
                    "max_keys": 100000,
                    "eviction_policy": "lru",
                    "overflow_strategy": "evict_and_track",
                    "profiles": {
                        "partner_tier": {
                            "label": "Partner 500 req/s",
                            "rate": 500,
                            "period_secs": 1,
                            "burst": 1000,
                            "limit_by": "client_ip",
                            "action_on_exceeded": "throttle"
                        }
                    },
                    "rules": []
                })
                .to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "ext-comp".to_string(),
                key: "builtin/response-compression".to_string(),
                version: 1,
                renderer: "response-compression".to_string(),
                manifest_digest: "abc".to_string(),
                config_json: serde_json::json!({
                    "enabled": true,
                    "routes_override": []
                })
                .to_string(),
            },
        ];

        let mut rendered = render_extensions(&instances).expect("render must succeed");
        let routing = RoutingSpec {
            domains: vec![DomainRoutingSpec {
                host: "api.aurora.local".to_string(),
                locations: vec![LocationRoutingSpec {
                    path: "/api/v1/catalog".to_string(),
                    upstream: "app_blue".to_string(),
                    strip_path: true,
                    websocket: false,
                    priority: 10,
                    plugins_json: Some(
                        serde_json::json!({
                            "response-cache": { "enabled": true, "profile": "vip_cache" },
                            "rate-limit": { "enabled": true, "profile": "partner_tier" },
                            "response-compression": { "enabled": true, "profile": "fast_zstd" },
                            "jwt-authentication": { "enabled": false, "profile": "off" }
                        })
                        .to_string(),
                    ),
                    origin_tls: None,
                }],
            }],
        };

        compile_route_masks_into_shm(&routing, &mut rendered);

        // 1. Check route mask
        let mask_bytes = rendered.get_shm_slot(AURORA_SLOT_ROUTE_MASKS).unwrap();
        let snap: RouteMaskSnapshot = serde_json::from_slice(mask_bytes).unwrap();
        let rule = snap.routes.iter().find(|r| r.path == "/api/v1/catalog").unwrap();
        assert!(rule.explicit);
        assert_ne!(rule.allow_mask & (1 << AURORA_EXT_RESPONSE_CACHE), 0);
        assert_ne!(rule.allow_mask & (1 << AURORA_EXT_RATE_LIMIT), 0);
        assert_ne!(rule.allow_mask & (1 << AURORA_EXT_RESPONSE_COMPRESSION), 0);
        assert_eq!(rule.allow_mask & (1 << AURORA_EXT_JWT), 0);

        // 2. Check custom profile `vip_cache` resolved into response-cache SHM
        let cache_val = rendered.get_shm_slot_json(AURORA_EXT_RESPONSE_CACHE).unwrap();
        let cache_overrides = cache_val["routes_override"].as_array().unwrap();
        assert_eq!(cache_overrides.len(), 1);
        assert_eq!(cache_overrides[0]["path_prefix"], "/api/v1/catalog");
        assert_eq!(cache_overrides[0]["ttl_secs"], 600);
        assert_eq!(cache_overrides[0]["cache_key_headers"][0], "X-Tenant-ID");

        // 3. Check custom profile `partner_tier` resolved into rate-limit SHM
        let rl_val = rendered.get_shm_slot_json(AURORA_EXT_RATE_LIMIT).unwrap();
        let rl_rules = rl_val["rules"].as_array().unwrap();
        assert_eq!(rl_rules.len(), 1);
        assert_eq!(rl_rules[0]["path_prefix"], "/api/v1/catalog");
        assert_eq!(rl_rules[0]["rate"], 500);
        assert_eq!(rl_rules[0]["burst"], 1000);

        // 4. Check built-in profile `fast_zstd` resolved into response-compression SHM
        let comp_val = rendered.get_shm_slot_json(AURORA_EXT_RESPONSE_COMPRESSION).unwrap();
        let comp_overrides = comp_val["routes_override"].as_array().unwrap();
        assert_eq!(comp_overrides.len(), 1);
        assert_eq!(comp_overrides[0]["path_prefix"], "/api/v1/catalog");
        assert_eq!(comp_overrides[0]["min_length"], 256);
    }
}
