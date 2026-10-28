use serde::{Deserialize, Serialize};

pub const NUM_SHARDS: usize = 16;
pub const MAX_CONN_LIMIT_RULES: usize = 64;
pub const MAX_CONN_LIMIT_POLICY_BYTES: usize = 131_072; // 128KB

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
pub enum ConnLimitMode {
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
    #[serde(default = "default_lease_ttl_secs")]
    pub lease_ttl_secs: u32,
    #[serde(default)]
    pub tls: Option<TlsConfigInput>,
}

fn default_redis_timeout_ms() -> u64 {
    50
}

fn default_redis_pool_size() -> usize {
    8
}

fn default_lease_ttl_secs() -> u32 {
    60
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct HeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct RuleInput {
    pub id: String,
    #[serde(default)]
    pub priority: u32,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default = "default_limit_by")]
    pub limit_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    pub max_connections: u32,
    #[serde(default)]
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: Option<u16>,
    pub response_headers: Option<Vec<HeaderInput>>,
    pub response_body: Option<String>,
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

#[derive(Deserialize)]
pub(crate) struct ConnLimitSnapshot {
    pub schema_version: u32,
    pub generation: u64,
    #[serde(default)]
    pub mode: ConnLimitMode,
    #[serde(default)]
    pub redis: Option<RedisConfigInput>,
    pub rules: Vec<RuleInput>,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub host: String,
    pub path_prefix: String,
    pub limit_by: LimitBy,
    pub header_name: Option<String>,
    pub max_connections: u32,
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: u16,
    pub response_headers: Vec<CompiledHeader>,
    pub response_body: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnLimitToken {
    pub rule_id: String,
    pub identifier: Vec<u8>,
    pub is_redis: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnLimitDecision {
    pub allowed: bool,
    pub action: ActionOnExceeded,
    pub status_code: u16,
    pub current_connections: u32,
    pub max_connections: u32,
    pub token: Option<ConnLimitToken>,
    pub headers: Vec<ResolvedHeader>,
    pub body: Option<Vec<u8>>,
}
