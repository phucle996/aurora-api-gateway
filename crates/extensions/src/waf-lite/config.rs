//! WAF Lite Policy Configuration Schema
//!
//! Fully decoupled, user-driven configuration for vector pattern inspection.
//! The dataplane receives raw string patterns to match without any hardcoded presets.

use serde::{Deserialize, Serialize};

pub const MAX_WAF_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WafMode {
    #[default]
    Block,
    Log,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WafRuleInput {
    pub pattern: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WafLiteSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub mode: WafMode,
    #[serde(default = "default_true")]
    pub inspect_headers: bool,
    /// Flat list of string patterns to block/match (e.g. `["union select", "${jndi:", "../.."]`)
    #[serde(default)]
    pub patterns: Vec<String>,
    /// Or structured rules with optional descriptions
    #[serde(default)]
    pub rules: Vec<WafRuleInput>,
    /// Trusted URI path prefixes that bypass WAF inspection (e.g. `["/healthz", "/metrics"]`)
    #[serde(default)]
    pub whitelist_paths: Vec<String>,
}

fn default_schema_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

impl Default for WafLiteSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            generation: 1,
            enabled: true,
            mode: WafMode::Block,
            inspect_headers: true,
            patterns: Vec::new(),
            rules: Vec::new(),
            whitelist_paths: Vec::new(),
        }
    }
}
