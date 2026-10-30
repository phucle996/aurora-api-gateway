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
    pub secret_bytes: Option<std::sync::Arc<[u8]>>,
    pub allowed_cidrs: Vec<(u32, u32)>,
}

#[cfg(test)]
mod tests {
    use crate::blue_green::BlueGreenEngine;

    #[test]
    fn test_flat_format_compatibility() {
        let policy = r#"{
            "schema_version": 1,
            "generation": 5,
            "active_slot": "green",
            "blue_upstream": "app_blue",
            "green_upstream": "app_green",
            "switch_header": "x-deploy-slot"
        }"#;

        let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
        assert_eq!(engine.rules_count(), 1);
    }

    #[test]
    fn test_flat_format_default_switch_header_works() {
        let policy = r#"{
            "schema_version": 1,
            "generation": 1,
            "active_slot": "blue",
            "blue_upstream": "app_blue",
            "green_upstream": "app_green"
        }"#;

        let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
        assert_eq!(engine.rules_count(), 1);
    }

    #[test]
    fn test_longest_path_prefix_specificity_sorting() {
        let policy = r#"{
            "schema_version": 1,
            "generation": 1,
            "rules": [
                {
                    "id": "a-root-catchall",
                    "priority": 100,
                    "origin": "*",
                    "path_prefix": "/",
                    "active_slot": "blue",
                    "blue_upstream": "root_blue",
                    "green_upstream": "root_green"
                },
                {
                    "id": "z-checkout-specific",
                    "priority": 100,
                    "origin": "*",
                    "path_prefix": "/api/v1/checkout",
                    "active_slot": "green",
                    "blue_upstream": "checkout_blue",
                    "green_upstream": "checkout_green"
                }
            ]
        }"#;

        let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
        let req = crate::blue_green::BlueGreenEvalRequest::new(b"example.com", b"/api/v1/checkout/pay");
        let d = engine.evaluate(&req, |_| None);
        assert!(d.matched);
        assert_eq!(d.rule_id, "z-checkout-specific");
        assert_eq!(d.upstream, "checkout_green");
    }

    #[test]
    fn test_invalid_policy_rejections() {
        // Same blue and green upstream
        let same = r#"{
            "schema_version": 1, "generation": 1,
            "rules": [{
                "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "blue",
                "blue_upstream": "target", "green_upstream": "target"
            }]
        }"#;
        assert!(BlueGreenEngine::from_snapshot(same.as_bytes()).is_err());

        // Invalid active slot
        let bad_slot = r#"{
            "schema_version": 1, "generation": 1,
            "rules": [{
                "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "purple",
                "blue_upstream": "blue", "green_upstream": "green"
            }]
        }"#;
        assert!(BlueGreenEngine::from_snapshot(bad_slot.as_bytes()).is_err());

        // Missing upstreams
        let empty = r#"{ "schema_version": 1 }"#;
        assert!(BlueGreenEngine::from_snapshot(empty.as_bytes()).is_err());

        // Invalid CIDR
        let bad_cidr = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "blue", "green_upstream": "green",
            "allowed_cidrs": ["not-an-ip/33"]
        }"#;
        assert!(BlueGreenEngine::from_snapshot(bad_cidr.as_bytes()).is_err());

        // Trimmed duplicate upstreams ("app_blue" vs "  app_blue  ")
        let trimmed_same = r#"{
            "schema_version": 1, "generation": 1,
            "rules": [{
                "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "blue",
                "blue_upstream": "app_blue", "green_upstream": "  app_blue  "
            }]
        }"#;
        assert!(BlueGreenEngine::from_snapshot(trimmed_same.as_bytes()).is_err());

        // CRLF header injection in upstream_headers
        let crlf_hdr = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "blue", "green_upstream": "green",
            "blue_upstream_headers": [{ "name": "x-slot", "value": "blue\r\nX-Injected: pwned" }]
        }"#;
        assert!(BlueGreenEngine::from_snapshot(crlf_hdr.as_bytes()).is_err());

        // Invalid characters in secret_header
        let bad_secret_hdr = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "blue", "green_upstream": "green",
            "preview_secret_header": "invalid header name!"
        }"#;
        assert!(BlueGreenEngine::from_snapshot(bad_secret_hdr.as_bytes()).is_err());
    }
}
