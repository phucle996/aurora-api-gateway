use crate::spec::extensions::ExtensionInstanceSpec;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::net::IpAddr;

#[derive(Clone, Debug, Deserialize)]
pub struct IpRestrictionConfig {
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default)]
    pub blacklist: Vec<String>,
    #[serde(default)]
    pub rules: Vec<IpRestrictionRule>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IpRestrictionRule {
    pub id: String,
    pub cidr: String,
    pub r#type: String,
    pub match_value: String,
    pub action: String,
    #[serde(default)]
    pub priority: Option<u32>,
    #[serde(default = "default_rule_enabled")]
    pub enabled: bool,
}

fn default_rule_enabled() -> bool {
    true
}

pub fn validate_ip_restriction_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<IpRestrictionConfig, String> {
    let parsed: IpRestrictionConfig = serde_json::from_value(Value::Object(config.clone()))
        .map_err(|error| {
            format!(
                "decode ip-restriction extension {} config: {error}",
                instance.instance_id
            )
        })?;

    for cidr in &parsed.whitelist {
        normalized_cidr(cidr)?;
    }

    for cidr in &parsed.blacklist {
        normalized_cidr(cidr)?;
    }

    for configured in &parsed.rules {
        if !configured.enabled {
            continue;
        }

        let expected_action = match configured.r#type.as_str() {
            "whitelist" => "allow",
            "blacklist" => "block",
            other => {
                return Err(format!(
                    "ip-restriction rule {} has unsupported type {other}",
                    configured.id
                ));
            }
        };

        if configured.action != expected_action {
            return Err(format!(
                "ip-restriction rule {} action must be {expected_action} for {}",
                configured.id, configured.r#type
            ));
        }

        if let Some(priority) = configured.priority
            && priority > 1_000_000
        {
            return Err(format!(
                "ip-restriction rule {} priority exceeds 1000000",
                configured.id
            ));
        }

        let path = if configured.match_value.is_empty() {
            "/"
        } else {
            configured.match_value.as_str()
        };

        if !path.starts_with('/') {
            return Err(format!(
                "ip-restriction rule {} path must begin with /",
                configured.id
            ));
        }

        normalized_cidr(&configured.cidr)?;
    }

    let active_rules_count = parsed.whitelist.len()
        + parsed.blacklist.len()
        + parsed.rules.iter().filter(|r| r.enabled).count();

    if active_rules_count > 512 {
        return Err("extension ip-restriction policies exceed 512 rules".to_string());
    }

    Ok(parsed)
}

pub fn normalized_cidr(raw: &str) -> Result<String, String> {
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
