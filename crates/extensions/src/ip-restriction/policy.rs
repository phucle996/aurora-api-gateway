//! Flat Declarative Policy Schema & Validation for IP Restriction (Slot 0).
//!
//! Enforces zero-allocation parsing, strict schema validation, and bounded invariants
//! for Ingress IP Whitelisting, Blacklisting, and multi-tier CIDR subnet access control.

use serde::{Deserialize, Serialize};

pub const MAX_IP_RESTRICTION_POLICY_BYTES: usize = 131_072;
pub const MAX_IP_RULES: usize = 65_536;
pub const MAX_PATH_PREFIX_LEN: usize = 8192;
pub const MAX_HOST_LEN: usize = 253;

fn default_schema_version() -> u32 {
    1
}

fn default_generation() -> u64 {
    1
}

fn default_wildcard() -> String {
    "*".to_string()
}

/// Evaluates normalized CIDR representation for single IPs and subnets.
#[inline]
pub fn normalize_cidr_string(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if s.contains('/') {
        Some(s.to_string())
    } else if s.contains(':') {
        Some(format!("{s}/128"))
    } else {
        Some(format!("{s}/32"))
    }
}

/// Flat rule configuration for IP restriction policy.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct IpRule {
    #[serde(default)]
    pub id: serde_json::Value,
    #[serde(default)]
    pub cidr: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub match_value: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub priority: Option<u32>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub networks: Vec<String>,
    #[serde(default)]
    pub path_prefix: Option<String>,
    #[serde(default = "default_wildcard")]
    pub host: String,
    #[serde(default = "default_wildcard")]
    pub method: String,
    #[serde(default)]
    pub log: bool,
}

/// Flat Declarative Policy Schema for IP Restriction (Slot 0).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct IpRestrictionPolicy {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_generation")]
    pub generation: u64,
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default)]
    pub blacklist: Vec<String>,
    #[serde(default)]
    pub rules: Vec<IpRule>,
}

impl IpRestrictionPolicy {
    /// Validates all structural invariants of the policy.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schema_version {}, expected 1",
                self.schema_version
            ));
        }

        if self.generation > i64::MAX as u64 {
            return Err(format!(
                "generation {} exceeds maximum signed 64-bit bound",
                self.generation
            ));
        }

        let total_rules = self.whitelist.len() + self.blacklist.len() + self.rules.len();
        if total_rules > MAX_IP_RULES {
            return Err(format!(
                "total rules {total_rules} exceeds maximum bound {MAX_IP_RULES}"
            ));
        }

        for (idx, cidr) in self.whitelist.iter().enumerate() {
            if normalize_cidr_string(cidr).is_none() {
                return Err(format!("whitelist[{idx}]: empty or invalid CIDR"));
            }
        }

        for (idx, cidr) in self.blacklist.iter().enumerate() {
            if normalize_cidr_string(cidr).is_none() {
                return Err(format!("blacklist[{idx}]: empty or invalid CIDR"));
            }
        }

        for (idx, rule) in self.rules.iter().enumerate() {
            if let Some(pri) = rule.priority
                && pri > 1_000_000
            {
                return Err(format!(
                    "rules[{idx}]: priority {pri} exceeds maximum allowed 1,000,000"
                ));
            }

            if rule.host.is_empty() || rule.host.len() > MAX_HOST_LEN {
                return Err(format!(
                    "rules[{idx}]: host length {} exceeds limit {MAX_HOST_LEN}",
                    rule.host.len()
                ));
            }

            let path = rule
                .path_prefix
                .as_deref()
                .filter(|p| !p.is_empty())
                .unwrap_or(if !rule.match_value.is_empty() {
                    &rule.match_value
                } else {
                    "/"
                });

            if !path.starts_with('/') {
                return Err(format!(
                    "rules[{idx}]: path_prefix '{path}' must start with '/'"
                ));
            }
            if path.len() > MAX_PATH_PREFIX_LEN {
                return Err(format!(
                    "rules[{idx}]: path_prefix length {} exceeds limit {MAX_PATH_PREFIX_LEN}",
                    path.len()
                ));
            }
            if path
                .bytes()
                .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
            {
                return Err(format!(
                    "rules[{idx}]: path_prefix contains invalid URI characters"
                ));
            }
            if path.contains("//") || path.split('/').any(|s| s == "." || s == "..") {
                return Err(format!(
                    "rules[{idx}]: path_prefix contains invalid relative path components"
                ));
            }

            let has_cidr = !rule.cidr.trim().is_empty();
            let has_nets = !rule.networks.is_empty();
            if !has_cidr && !has_nets {
                return Err(format!(
                    "rules[{idx}]: rule must define at least one valid CIDR or network"
                ));
            }
        }

        Ok(())
    }
}

/// Request evaluation context payload for IP restriction engine.
pub struct IpRestrictionRequest<'a> {
    pub ip: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub now: u64,
}

// Backward compatibility type aliases
pub type IpRestrictionSnapshot = IpRestrictionPolicy;
pub type ConfiguredRule = IpRule;
