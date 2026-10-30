//! Declarative Snapshot Schema, Memory Topology & Precompiled Blue-Green Policy Rules
//!
//! Handles JSON deserialization, validation, priority sorting, and precompilation
//! of network CIDRs, FNV-1a secret hashes, and 64-byte L1 cacheline slot sheets.

use std::sync::Arc;
use serde::{Deserialize, Serialize};

pub const SLOT_BLUE: u8 = 0;
pub const SLOT_GREEN: u8 = 1;

pub const MAX_BLUE_GREEN_RULES: usize = 64;
pub const MAX_BLUE_GREEN_POLICY_BYTES: usize = 131_072; // 128KB

pub const SLOT_NAMES: [&str; 2] = ["blue", "green"];

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeploySlot {
    #[default]
    Blue = 0,
    Green = 1,
}

impl DeploySlot {
    #[inline(always)]
    pub const fn as_str(&self) -> &'static str {
        match self {
            DeploySlot::Blue => "blue",
            DeploySlot::Green => "green",
        }
    }

    #[inline(always)]
    pub const fn to_u8(&self) -> u8 {
        match self {
            DeploySlot::Blue => SLOT_BLUE,
            DeploySlot::Green => SLOT_GREEN,
        }
    }

    #[inline(always)]
    pub const fn from_u8(slot: u8) -> &'static str {
        match slot {
            SLOT_GREEN => "green",
            _ => "blue",
        }
    }

    pub fn from_str_ignore_case(s: &str) -> Option<Self> {
        let trimmed = s.trim();
        if trimmed.eq_ignore_ascii_case("blue") {
            Some(DeploySlot::Blue)
        } else if trimmed.eq_ignore_ascii_case("green") {
            Some(DeploySlot::Green)
        } else {
            None
        }
    }
}

/// Metadata and precompiled headers for a single deployment slot (exactly 32 bytes).
/// 2 slots = 64 bytes, perfectly fitting inside a single 64-byte L1 CPU cacheline.
#[repr(C)]
#[derive(Clone, Debug)]
pub struct SlotUpstreamMeta {
    pub upstream: Arc<str>,
    pub headers: Arc<[(String, String)]>,
}

/// Contiguous 64-byte aligned slot sheet: [0] = Blue, [1] = Green.
/// Resides 100% in a single L1 data cacheline with 0 boundary crossings.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct SlotSheet {
    pub upstreams: [SlotUpstreamMeta; 2],
}

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
pub struct CompiledBlueGreenRule {
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
    pub secret_bytes: Option<Arc<[u8]>>,
    pub allowed_cidrs: Vec<(u32, u32)>,
}

/// Request context evaluated by BlueGreenEngine.
#[derive(Clone, Copy, Debug)]
pub struct BlueGreenEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub client_ip: &'a [u8],
    pub query: &'a [u8],
}

impl<'a> BlueGreenEvalRequest<'a> {
    pub const fn new(origin: &'a [u8], path: &'a [u8]) -> Self {
        Self {
            origin,
            path,
            client_ip: b"",
            query: b"",
        }
    }

    pub const fn with_details(
        origin: &'a [u8],
        path: &'a [u8],
        client_ip: &'a [u8],
        query: &'a [u8],
    ) -> Self {
        Self {
            origin,
            path,
            client_ip,
            query,
        }
    }
}

/// Access Phase routing decision for Blue-Green extension.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlueGreenDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub upstream: &'a str,
    pub active_slot: &'static str,
    pub is_header_override: bool,
    pub upstream_headers: &'a [(String, String)],
    pub headers_arc: Option<Arc<[(String, String)]>>,
}

impl<'a> BlueGreenDecision<'a> {
    #[inline(always)]
    pub fn unmatched() -> BlueGreenDecision<'static> {
        BlueGreenDecision {
            matched: false,
            rule_id: "",
            upstream: "",
            active_slot: "",
            is_header_override: false,
            upstream_headers: &[],
            headers_arc: None,
        }
    }

    #[inline(always)]
    pub fn matched(
        rule_id: &'a str,
        upstream: &'a str,
        active_slot: &'static str,
        is_header_override: bool,
        headers_arc: &'a Arc<[(String, String)]>,
    ) -> Self {
        let (hdrs, arc_opt) = if headers_arc.is_empty() {
            (&[][..], None)
        } else {
            (headers_arc.as_ref(), Some(Arc::clone(headers_arc)))
        };
        Self {
            matched: true,
            rule_id,
            upstream,
            active_slot,
            is_header_override,
            upstream_headers: hdrs,
            headers_arc: arc_opt,
        }
    }
}
