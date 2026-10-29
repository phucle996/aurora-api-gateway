//! Declarative Snapshot Configuration Schema and Input DTOs
//!
//! Provides deserialization models for NodeSpec JSON snapshots and request payloads.

use serde::Deserialize;

fn default_wildcard() -> String {
    "*".to_string()
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug, Deserialize)]
pub struct ConfiguredRule {
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

#[derive(Deserialize)]
pub struct IpRestrictionSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub whitelist: Vec<String>,
    #[serde(default)]
    pub blacklist: Vec<String>,
    #[serde(default)]
    pub rules: Vec<ConfiguredRule>,
}

pub struct IpRestrictionRequest<'a> {
    pub ip: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub now: u64,
}

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
