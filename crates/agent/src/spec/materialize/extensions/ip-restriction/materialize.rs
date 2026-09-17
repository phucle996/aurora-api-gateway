use super::validator::{normalized_cidr, validate_ip_restriction_config};
use crate::spec::extensions::ExtensionInstanceSpec;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub fn materialize(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
    ip_restriction_policy: &mut Option<Value>,
    server: &mut String,
    has_server: &mut bool,
) -> Result<(), String> {
    if ip_restriction_policy.is_some() {
        return Err("NodeSpec contains more than one ip-restriction extension".to_string());
    }

    let parsed = validate_ip_restriction_config(instance, config)?;

    let mut rules = Vec::new();
    let mut used_ids = HashSet::new();

    for (index, cidr) in parsed.whitelist.iter().enumerate() {
        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("whitelist:{index}"),
                cidr,
                action: "allow",
                priority: 10,
                path_prefix: "/",
            },
            &mut rules,
            &mut used_ids,
        )?;
    }

    for (index, cidr) in parsed.blacklist.iter().enumerate() {
        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("blacklist:{index}"),
                cidr,
                action: "block",
                priority: 20,
                path_prefix: "/",
            },
            &mut rules,
            &mut used_ids,
        )?;
    }

    for (index, configured) in parsed.rules.iter().enumerate() {
        if !configured.enabled {
            continue;
        }

        let priority = configured.priority.unwrap_or(100 + index as u32);
        let path = if configured.match_value.is_empty() {
            "/"
        } else {
            configured.match_value.as_str()
        };

        append_access_rule(
            instance,
            AccessRuleInput {
                source: &format!("rule:{}", configured.id),
                cidr: &configured.cidr,
                action: &configured.action,
                priority,
                path_prefix: path,
            },
            &mut rules,
            &mut used_ids,
        )?;
    }

    *ip_restriction_policy = Some(json!({
        "rules": rules,
    }));

    server.push_str("gateway_access_policy /var/lib/aurora-policy/active-ip-restriction.json;\n");
    *has_server = true;

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
            "ip-restriction rule {} path must begin with /",
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
        "path_prefix": input.path_prefix,
    }));

    Ok(())
}
