use serde::{Deserialize, Serialize};

pub const MAX_CANARY_RELEASE_RULES: usize = 64;
pub const MAX_CANARY_RELEASE_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplitBy {
    #[default]
    ClientIp,
    Header,
    Random,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchTarget {
    Header,
    Uri,
    Query,
}

#[derive(Deserialize, Clone, Debug)]
pub struct MatchConditionInput {
    pub target: String,
    #[serde(default)]
    pub key: Option<String>,
    pub regex: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct UpstreamHeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct CanaryReleaseRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    pub baseline_upstream: String,
    pub canary_upstream: String,
    #[serde(default)]
    pub match_conditions: Vec<MatchConditionInput>,
    #[serde(default = "default_weight_percentage")]
    pub weight_percentage: u32,
    #[serde(default = "default_split_by")]
    pub split_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    #[serde(default)]
    pub canary_upstream_headers: Vec<UpstreamHeaderInput>,
    #[serde(default)]
    pub baseline_upstream_headers: Vec<UpstreamHeaderInput>,
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
fn default_weight_percentage() -> u32 {
    0
}
fn default_split_by() -> String {
    "client_ip".to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct CanaryReleaseSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<CanaryReleaseRuleInput>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledMatchCondition {
    pub target: MatchTarget,
    pub key: Option<String>,
    pub regex: regex::Regex,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledCanaryRule {
    pub id: String,
    pub origin: String,
    pub path_prefix: String,
    pub baseline_upstream: String,
    pub canary_upstream: String,
    pub match_conditions: Vec<CompiledMatchCondition>,
    pub weight_percentage: u32,
    pub split_by: SplitBy,
    pub header_name: Option<String>,
    pub canary_upstream_headers: Vec<(String, String)>,
    pub baseline_upstream_headers: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug)]
pub struct CanaryReleaseEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub uri: &'a [u8],
    pub query_string: &'a [u8],
    pub client_ip: &'a [u8],
    pub random_seed: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanaryDecision {
    pub matched: bool,
    pub rule_id: String,
    pub upstream: String,
    pub is_canary: bool,
    pub upstream_headers: Vec<(String, String)>,
}

impl CanaryDecision {
    pub fn unmatched() -> Self {
        Self {
            matched: false,
            rule_id: String::new(),
            upstream: String::new(),
            is_canary: false,
            upstream_headers: Vec::new(),
        }
    }

    pub fn matched(
        rule_id: String,
        upstream: String,
        is_canary: bool,
        upstream_headers: Vec<(String, String)>,
    ) -> Self {
        Self {
            matched: true,
            rule_id,
            upstream,
            is_canary,
            upstream_headers,
        }
    }
}
