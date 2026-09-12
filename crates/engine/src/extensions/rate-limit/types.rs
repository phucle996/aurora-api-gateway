use serde::{Deserialize, Serialize};

pub const NUM_SHARDS: usize = 16;
pub const MAX_RATE_LIMIT_RULES: usize = 64;
pub const MAX_RATE_LIMIT_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitAlgorithm {
    #[default]
    TokenBucket,
    LeakyBucket,
    FixedWindow,
    SlidingWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EvictionPolicy {
    #[default]
    Lru,
    Lfu,
    Fifo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OverflowStrategy {
    #[default]
    EvictAndTrack,
    DropNew,
    BypassNew,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ActionOnExceeded {
    #[default]
    Throttle,
    Block,
    Audit,
    CustomResponse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LimitBy {
    #[default]
    ClientIp,
    ApiKey,
    Authorization,
    RoutePath,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Snapshot {
    pub schema_version: u32,
    pub generation: u64,
    pub algorithm: RateLimitAlgorithm,
    pub memory_size_mb: u32,
    pub max_keys: usize,
    pub eviction_policy: EvictionPolicy,
    pub overflow_strategy: OverflowStrategy,
    pub rules: Vec<RuleInput>,
}

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuleInput {
    pub id: String,
    #[serde(default)]
    pub priority: u32,
    pub host: String,
    pub path_prefix: String,
    pub limit_by: String,
    pub rate: u64,
    pub period_secs: u64,
    #[serde(default)]
    pub burst: Option<u64>,
    pub action_on_exceeded: ActionOnExceeded,
    #[serde(default)]
    pub rejected_code: Option<u16>,
    #[serde(default)]
    pub custom_message: Option<String>,
}

#[derive(Clone)]
pub(crate) struct CompiledRule {
    #[allow(dead_code)]
    pub id: String,
    pub host: Vec<u8>,
    pub path_prefix: Vec<u8>,
    pub limit_by: LimitBy,
    pub rate: u64,
    pub period_secs: u64,
    pub burst: u64,
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: u16,
    #[allow(dead_code)]
    pub custom_message: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub action: ActionOnExceeded,
    pub status_code: u16,
    pub retry_after_secs: u32,
    pub remaining: u32,
    pub reset_epoch_secs: u64,
}
