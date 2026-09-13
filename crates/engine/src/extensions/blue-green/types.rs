use serde::{Deserialize, Serialize};

pub const MAX_BLUE_GREEN_RULES: usize = 64;
pub const MAX_BLUE_GREEN_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DeploySlot {
    #[default]
    Blue,
    Green,
}

impl DeploySlot {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeploySlot::Blue => "blue",
            DeploySlot::Green => "green",
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
    #[serde(default)]
    pub switch_header: Option<String>,
    #[serde(default)]
    pub blue_upstream_headers: Vec<UpstreamHeaderInput>,
    #[serde(default)]
    pub green_upstream_headers: Vec<UpstreamHeaderInput>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledBlueGreenRule {
    pub id: String,
    pub origin: String,
    pub path_prefix: String,
    pub active_slot: DeploySlot,
    pub blue_upstream: String,
    pub green_upstream: String,
    pub switch_header: Option<String>,
    pub blue_upstream_headers: Vec<(String, String)>,
    pub green_upstream_headers: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug)]
pub struct BlueGreenEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BlueGreenDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub upstream: &'a str,
    pub active_slot: &'a str,
    pub is_header_override: bool,
    pub upstream_headers: &'a [(String, String)],
}

impl<'a> BlueGreenDecision<'a> {
    pub const fn unmatched() -> BlueGreenDecision<'static> {
        BlueGreenDecision {
            matched: false,
            rule_id: "",
            upstream: "",
            active_slot: "",
            is_header_override: false,
            upstream_headers: &[],
        }
    }

    pub const fn matched(
        rule_id: &'a str,
        upstream: &'a str,
        active_slot: &'a str,
        is_header_override: bool,
        upstream_headers: &'a [(String, String)],
    ) -> Self {
        Self {
            matched: true,
            rule_id,
            upstream,
            active_slot,
            is_header_override,
            upstream_headers,
        }
    }
}
