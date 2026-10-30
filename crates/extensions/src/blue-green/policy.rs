//! Declarative Snapshot Schema & Precompiled Blue-Green Policy Rules
//!
//! Handles JSON deserialization, validation, priority sorting, and precompilation
//! of network CIDRs, FNV-1a secret hashes, and L1 cacheline slot sheets.

use serde::Deserialize;
use super::sheet::SlotSheet;

pub const MAX_BLUE_GREEN_RULES: usize = 64;
pub const MAX_BLUE_GREEN_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Deserialize, Clone, Debug)]
pub struct UpstreamHeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct BlueGreenRuleInput {
    #[serde(default = "default_rule_id")]
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default)]
    pub active_slot: Option<String>,
    pub blue_upstream: String,
    pub green_upstream: String,
    #[serde(default = "default_switch_header")]
    pub switch_header: Option<String>,
    #[serde(default)]
    pub preview_cookie: Option<String>,
    #[serde(default)]
    pub preview_query_param: Option<String>,
    #[serde(default)]
    pub preview_secret: Option<String>,
    #[serde(default = "default_secret_header")]
    pub preview_secret_header: Option<String>,
    #[serde(default)]
    pub allowed_cidrs: Vec<String>,
    #[serde(default)]
    pub blue_upstream_headers: Vec<UpstreamHeaderInput>,
    #[serde(default)]
    pub green_upstream_headers: Vec<UpstreamHeaderInput>,
}

fn default_rule_id() -> String {
    "default-blue-green".to_string()
}
fn default_priority() -> u32 {
    100
}
fn default_origin() -> String {
    "*".to_string()
}
fn default_path_prefix() -> String {
    "/".to_string()
}
fn default_switch_header() -> Option<String> {
    Some("x-deploy-slot".to_string())
}
fn default_secret_header() -> Option<String> {
    Some("x-preview-secret".to_string())
}

#[derive(Deserialize, Clone, Debug)]
pub struct BlueGreenSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<BlueGreenRuleInput>,

    // Flat format compatibility
    #[serde(default)]
    pub active_slot: Option<String>,
    #[serde(default)]
    pub blue_upstream: Option<String>,
    #[serde(default)]
    pub green_upstream: Option<String>,
    #[serde(default = "default_switch_header")]
    pub switch_header: Option<String>,
    #[serde(default)]
    pub preview_cookie: Option<String>,
    #[serde(default)]
    pub preview_query_param: Option<String>,
    #[serde(default)]
    pub preview_secret: Option<String>,
    #[serde(default = "default_secret_header")]
    pub preview_secret_header: Option<String>,
    #[serde(default)]
    pub allowed_cidrs: Vec<String>,
    #[serde(default)]
    pub blue_upstream_headers: Vec<UpstreamHeaderInput>,
    #[serde(default)]
    pub green_upstream_headers: Vec<UpstreamHeaderInput>,
}

fn default_schema_version() -> u32 {
    1
}

/// Fully compiled, zero-allocation internal rule representation.
#[derive(Clone, Debug)]
pub(crate) struct CompiledBlueGreenRule {
    pub id: String,
    pub is_wildcard_origin: bool,
    pub origin_bytes: Vec<u8>,
    pub path_prefix_bytes: Vec<u8>,
    pub path_prefix_ends_with_slash: bool,
    pub active_slot: u8,
    pub slot_sheet: SlotSheet,
    pub switch_header: Option<String>,
    pub preview_cookie: Option<Vec<u8>>,
    pub preview_query_param: Option<Vec<u8>>,
    pub secret_header: Option<String>,
    pub secret_hash: u64,
    pub allowed_cidrs: Vec<(u32, u32)>,
}
