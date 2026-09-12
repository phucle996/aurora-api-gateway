use crate::spec::extensions::ExtensionInstanceSpec;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::net::IpAddr;

#[derive(Deserialize)]
struct AccessPolicyConfig {
    #[serde(default)]
    whitelist: Vec<String>,
    #[serde(default)]
    blacklist: Vec<String>,
    #[serde(default)]
    rules: Vec<AccessPolicyRule>,
}

#[derive(Deserialize)]
struct AccessPolicyRule {
    id: String,
    cidr: String,
    r#type: String,
    match_value: String,
    action: String,
    #[serde(default)]
    priority: Option<u32>,
    #[serde(default = "default_rule_enabled")]
    enabled: bool,
}

fn default_rule_enabled() -> bool {
    true
}

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
    rules: &mut Vec<Value>,
    used_ids: &mut HashSet<u64>,
) -> Result<(), String> {
    let config = serde_json::from_value::<AccessPolicyConfig>(Value::Object(config.clone()))
        .map_err(|error| {
            format!(
                "decode access-policy extension {} config: {error}",
                instance.instance_id
            )
        })?;
    for (index, cidr) in config.whitelist.iter().enumerate() {
        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("whitelist:{index}"),
                cidr,
                action: "allow",
                priority: 10,
                path_prefix: "/",
            },
            rules,
            used_ids,
        )?;
    }
    for (index, cidr) in config.blacklist.iter().enumerate() {
        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("blacklist:{index}"),
                cidr,
                action: "block",
                priority: 20,
                path_prefix: "/",
            },
            rules,
            used_ids,
        )?;
    }
    for (index, configured) in config.rules.iter().enumerate() {
        if !configured.enabled {
            continue;
        }
        let expected_action = match configured.r#type.as_str() {
            "whitelist" => "allow",
            "blacklist" => "block",
            other => {
                return Err(format!(
                    "access-policy rule {} has unsupported type {other}",
                    configured.id
                ));
            }
        };
        if configured.action != expected_action {
            return Err(format!(
                "access-policy rule {} action must be {expected_action} for {}",
                configured.id, configured.r#type
            ));
        }
        let priority = configured.priority.unwrap_or(100 + index as u32);
        if priority > 1_000_000 {
            return Err(format!(
                "access-policy rule {} priority exceeds 1000000",
                configured.id
            ));
        }
        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("rule:{}", configured.id),
                cidr: &configured.cidr,
                action: &configured.action,
                priority,
                path_prefix: if configured.match_value.is_empty() {
                    "/"
                } else {
                    &configured.match_value
                },
            },
            rules,
            used_ids,
        )?;
    }
    if rules.len() > 512 {
        return Err("extension access policies exceed 512 rules".to_string());
    }
    Ok(())
}

struct AccessRuleInput<'a> {
    source: &'a str,
    cidr: &'a str,
    action: &'a str,
    priority: u32,
    path_prefix: &'a str,
}

fn append_access_rule(
    instance: &ExtensionInstanceSpec,
    input: AccessRuleInput<'_>,
    rules: &mut Vec<Value>,
    used_ids: &mut HashSet<u64>,
) -> Result<(), String> {
    let cidr = normalized_cidr(input.cidr)?;
    if !input.path_prefix.starts_with('/') {
        return Err(format!(
            "access-policy rule {} path must begin with /",
            input.source
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(instance.instance_id.as_bytes());
    hasher.update([0]);
    hasher.update(input.source.as_bytes());
    let digest = hasher.finalize();
    let mut id = u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 prefix"));
    if id == 0 {
        id = 1;
    }
    while !used_ids.insert(id) {
        id = id.wrapping_add(1);
        if id == 0 {
            id = 1;
        }
    }
    rules.push(json!({
        "id": id,
        "priority": input.priority,
        "action": input.action,
        "networks": [cidr],
        "host": "*",
        "path_prefix": input.path_prefix,
        "method": "*",
        "schedule": "always",
        "expires_at": 0,
        "log": false,
        "reputation": false,
        "alert": false,
    }));
    Ok(())
}

fn normalized_cidr(raw: &str) -> Result<String, String> {
    let (address, prefix) = raw
        .trim()
        .split_once('/')
        .ok_or_else(|| format!("CIDR {raw:?} is missing a prefix length"))?;
    let address = address
        .parse::<IpAddr>()
        .map_err(|_| format!("CIDR {raw:?} has an invalid address"))?;
    let prefix = prefix
        .parse::<u8>()
        .map_err(|_| format!("CIDR {raw:?} has an invalid prefix length"))?;
    match address {
        IpAddr::V4(address) => {
            if prefix > 32 {
                return Err(format!("CIDR {raw:?} prefix exceeds 32"));
            }
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            Ok(format!(
                "{}/{}",
                std::net::Ipv4Addr::from(u32::from(address) & mask),
                prefix
            ))
        }
        IpAddr::V6(address) => {
            if prefix > 128 {
                return Err(format!("CIDR {raw:?} prefix exceeds 128"));
            }
            if address.to_ipv4_mapped().is_some() {
                return Err(format!(
                    "CIDR {raw:?} must not use an IPv4-mapped IPv6 address"
                ));
            }
            let mask = if prefix == 0 {
                0
            } else {
                u128::MAX << (128 - prefix)
            };
            Ok(format!(
                "{}/{}",
                std::net::Ipv6Addr::from(u128::from(address) & mask),
                prefix
            ))
        }
    }
}
