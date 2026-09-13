use serde::{Deserialize, Serialize};

pub const MAX_TRAFFIC_SPLIT_RULES: usize = 64;
pub const MAX_TRAFFIC_SPLIT_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplitBy {
    #[default]
    ClientIp,
    Header,
    Random,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SplitTargetInput {
    pub upstream: String,
    pub weight: u32,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TrafficSplitRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default = "default_split_by")]
    pub split_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    pub splits: Vec<SplitTargetInput>,
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
fn default_split_by() -> String {
    "client_ip".to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct TrafficSplitSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<TrafficSplitRuleInput>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CompiledSplitTarget {
    pub upstream: String,
    pub cumulative_weight: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub origin: String,
    pub path_prefix: String,
    pub split_by: SplitBy,
    pub header_name: Option<String>,
    pub targets: Vec<CompiledSplitTarget>,
}

#[derive(Clone, Copy, Debug)]
pub struct TrafficSplitEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub client_ip: &'a [u8],
    pub random_seed: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrafficSplitDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub upstream: &'a str,
}

impl<'a> TrafficSplitDecision<'a> {
    pub const fn unmatched() -> TrafficSplitDecision<'static> {
        TrafficSplitDecision {
            matched: false,
            rule_id: "",
            upstream: "",
        }
    }

    pub const fn matched(rule_id: &'a str, upstream: &'a str) -> Self {
        Self {
            matched: true,
            rule_id,
            upstream,
        }
    }
}
