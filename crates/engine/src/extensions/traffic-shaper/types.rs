use serde::{Deserialize, Serialize};

pub const MAX_TRAFFIC_SHAPER_RULES: usize = 64;
pub const MAX_TRAFFIC_SHAPER_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LimitBy {
    #[default]
    ClientIp,
    Header,
    RoutePath,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TrafficShaperRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default = "default_limit_by")]
    pub limit_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    pub rate_kb_per_sec: u64,
    #[serde(default)]
    pub burst_kb: u64,
}

fn default_priority() -> u32 {
    100
}
fn default_host() -> String {
    "*".to_string()
}
fn default_path_prefix() -> String {
    "/".to_string()
}
fn default_limit_by() -> String {
    "client_ip".to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct TrafficShaperSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<TrafficShaperRuleInput>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub host: String,
    pub path_prefix: String,
    pub limit_by: LimitBy,
    pub header_name: Option<String>,
    pub rate_bytes_per_sec: u64,
    pub burst_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrafficShaperDecision<'a> {
    pub rate_bytes_per_sec: u64,
    pub burst_bytes: u64,
    pub matched: bool,
    pub rule_id: &'a str,
}

impl<'a> TrafficShaperDecision<'a> {
    pub const fn passthrough() -> TrafficShaperDecision<'static> {
        TrafficShaperDecision {
            rate_bytes_per_sec: 0,
            burst_bytes: 0,
            matched: false,
            rule_id: "",
        }
    }
}
