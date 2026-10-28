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
    Header,
    RoutePath,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitMode {
    #[default]
    Local,
    Distributed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnErrorAction {
    #[default]
    FallbackLocal,
    Pass,
    Block,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub(crate) struct TlsConfigInput {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub ca_cert_pem: Option<String>,
    #[serde(default)]
    pub client_cert_pem: Option<String>,
    #[serde(default)]
    pub client_key_pem: Option<String>,
    #[serde(default)]
    pub insecure_skip_verify: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct RedisConfigInput {
    pub endpoint: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub db: Option<i64>,
    #[serde(default = "default_redis_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_redis_pool_size")]
    pub pool_size: usize,
    #[serde(default)]
    pub on_error: OnErrorAction,
    #[serde(default)]
    pub custom_lua_script: Option<String>,
    #[serde(default)]
    pub tls: Option<TlsConfigInput>,
}

fn default_redis_timeout_ms() -> u64 {
    10
}

fn default_redis_pool_size() -> usize {
    8
}

#[derive(Deserialize)]
pub(crate) struct Snapshot {
    pub schema_version: u32,
    pub generation: u64,
    #[serde(default)]
    pub mode: RateLimitMode,
    pub algorithm: RateLimitAlgorithm,
    pub memory_size_mb: u32,
    pub max_keys: usize,
    pub eviction_policy: EvictionPolicy,
    pub overflow_strategy: OverflowStrategy,
    #[serde(default)]
    pub redis: Option<RedisConfigInput>,
    pub rules: Vec<RuleInput>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct HeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHeader {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone)]
pub(crate) struct RuleInput {
    pub id: String,
    #[serde(default)]
    pub priority: u32,
    pub host: String,
    pub path_prefix: String,
    pub limit_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    pub rate: u64,
    pub period_secs: u64,
    #[serde(default)]
    pub burst: Option<u64>,
    pub action_on_exceeded: ActionOnExceeded,
    #[serde(default)]
    pub rejected_code: Option<u16>,
    #[serde(default)]
    pub custom_message: Option<String>,
    #[serde(default)]
    pub response_headers: Option<Vec<HeaderInput>>,
}

#[derive(Clone)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub host: Vec<u8>,
    pub path_prefix: Vec<u8>,
    pub limit_by: LimitBy,
    pub header_name: Option<String>,
    pub rate: u64,
    pub period_secs: u64,
    pub burst: u64,
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: u16,
    pub custom_message: Option<String>,
    pub response_headers: Vec<CompiledHeader>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub action: ActionOnExceeded,
    pub status_code: u16,
    pub retry_after_secs: u32,
    pub remaining: u32,
    pub reset_epoch_secs: u64,
    pub custom_reason: Option<String>,
    pub headers: Vec<ResolvedHeader>,
    pub body: Option<Vec<u8>>,
}

impl RateLimitDecision {
    pub fn allow(remaining: u32, reset_epoch_secs: u64) -> Self {
        Self {
            allowed: true,
            action: ActionOnExceeded::Throttle,
            status_code: 200,
            retry_after_secs: 0,
            remaining,
            reset_epoch_secs,
            custom_reason: None,
            headers: Vec::new(),
            body: None,
        }
    }
}
