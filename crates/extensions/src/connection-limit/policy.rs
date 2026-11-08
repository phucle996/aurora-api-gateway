//! Flat Declarative Policy Schema & Validation for Connection Limit (Slot 3).
//!
//! Enforces zero-allocation parsing, strict schema validation, and bounded invariants
//! for local and distributed (Redis L2) concurrent connection tracking and slowloris defense.

use rustc_hash::FxHashSet;
use serde::{Deserialize, Serialize};

pub const MAX_CONN_LIMIT_RULES: usize = 64;
pub const MAX_CONN_LIMIT_POLICY_BYTES: usize = 131_072; // 128 KB
pub const MAX_HEADER_NAME_LEN: usize = 64;
pub const MAX_PATH_PREFIX_LEN: usize = 8192;
pub const MAX_HOST_LEN: usize = 253;

fn default_schema_version() -> u32 {
    1
}

fn default_generation() -> u64 {
    1
}

fn default_host() -> String {
    "*".to_string()
}

fn default_path_prefix() -> String {
    "/".to_string()
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

fn default_sync_interval_ms() -> u64 {
    500
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

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct TlsConfig {
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

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RedisConfig {
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
    #[serde(default = "default_sync_interval_ms")]
    pub sync_interval_ms: u64,
    #[serde(default)]
    pub tls: Option<TlsConfig>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CustomHeader {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ConnLimitRule {
    pub id: String,
    #[serde(default)]
    pub priority: u32,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default)]
    pub limit_by: LimitBy,
    #[serde(default)]
    pub header_name: Option<String>,
    pub max_connections: u32,
    #[serde(default)]
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: Option<u16>,
    pub response_headers: Option<Vec<CustomHeader>>,
    pub response_body: Option<String>,
}

/// Flat Declarative Policy Schema for Connection Limit (Slot 3).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ConnectionLimitPolicy {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_generation")]
    pub generation: u64,
    #[serde(default)]
    pub mode: ConnLimitMode,
    #[serde(default)]
    pub redis: Option<RedisConfig>,
    pub rules: Vec<ConnLimitRule>,
}

impl ConnectionLimitPolicy {
    /// Validates all structural and runtime invariants of the policy.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schema_version {}, expected 1",
                self.schema_version
            ));
        }

        if self.generation > i64::MAX as u64 {
            return Err(format!(
                "generation {} exceeds maximum signed 64-bit bound",
                self.generation
            ));
        }

        if self.rules.len() > MAX_CONN_LIMIT_RULES {
            return Err(format!(
                "rules count {} exceeds maximum bound {MAX_CONN_LIMIT_RULES}",
                self.rules.len()
            ));
        }

        if self.mode == ConnLimitMode::Distributed {
            let redis = self
                .redis
                .as_ref()
                .ok_or_else(|| "distributed mode requires redis configuration".to_string())?;

            if redis.endpoint.trim().is_empty() {
                return Err("redis endpoint cannot be empty in distributed mode".to_string());
            }
            if !(1..=5000).contains(&redis.timeout_ms) {
                return Err(format!(
                    "redis timeout_ms {} outside permitted range 1..=5000",
                    redis.timeout_ms
                ));
            }
            if !(1..=64).contains(&redis.pool_size) {
                return Err(format!(
                    "redis pool_size {} outside permitted range 1..=64",
                    redis.pool_size
                ));
            }
            if !(5..=86400).contains(&redis.lease_ttl_secs) {
                return Err(format!(
                    "redis lease_ttl_secs {} outside permitted range 5..=86400",
                    redis.lease_ttl_secs
                ));
            }
            if redis.sync_interval_ms > 0 && !(10..=60_000).contains(&redis.sync_interval_ms) {
                return Err(format!(
                    "redis sync_interval_ms {} outside permitted range 10..=60000",
                    redis.sync_interval_ms
                ));
            }
        }

        let mut seen_ids =
            FxHashSet::with_capacity_and_hasher(self.rules.len(), Default::default());

        for (idx, rule) in self.rules.iter().enumerate() {
            let trimmed_id = rule.id.trim();
            if trimmed_id.is_empty() || trimmed_id.len() > 128 {
                return Err(format!(
                    "rules[{idx}]: id cannot be empty and must be <= 128 characters"
                ));
            }
            if !seen_ids.insert(trimmed_id.to_string()) {
                return Err(format!("rules[{idx}]: duplicate rule id '{trimmed_id}'"));
            }

            if rule.priority > 1_000_000 {
                return Err(format!(
                    "rules[{idx}]: priority {} exceeds maximum 1,000,000",
                    rule.priority
                ));
            }

            if rule.host.is_empty() || rule.host.len() > MAX_HOST_LEN {
                return Err(format!(
                    "rules[{idx}]: host length {} exceeds limit {MAX_HOST_LEN}",
                    rule.host.len()
                ));
            }

            if !rule.path_prefix.starts_with('/') {
                return Err(format!(
                    "rules[{idx}]: path_prefix '{}' must start with '/'",
                    rule.path_prefix
                ));
            }
            if rule.path_prefix.len() > MAX_PATH_PREFIX_LEN {
                return Err(format!(
                    "rules[{idx}]: path_prefix length {} exceeds limit {MAX_PATH_PREFIX_LEN}",
                    rule.path_prefix.len()
                ));
            }
            if rule.path_prefix.contains("//")
                || rule.path_prefix.split('/').any(|s| s == "." || s == "..")
            {
                return Err(format!(
                    "rules[{idx}]: path_prefix contains invalid relative path components"
                ));
            }

            if rule.limit_by == LimitBy::Header {
                let h_name = rule.header_name.as_deref().map(str::trim).unwrap_or("");
                if h_name.is_empty()
                    || h_name.len() > MAX_HEADER_NAME_LEN
                    || !h_name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(format!(
                        "rules[{idx}]: limit_by 'header' requires valid header_name (<= {MAX_HEADER_NAME_LEN} chars)"
                    ));
                }
            }

            if let Some(code) = rule.rejected_code
                && !(400..=599).contains(&code)
            {
                return Err(format!(
                    "rules[{idx}]: rejected_code {code} must be a valid HTTP error code 400..=599"
                ));
            }
        }

        Ok(())
    }
}

/// Token representing an acquired connection slot returned to NGINX for lifecycle release.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnLimitToken {
    pub rule_id: String,
    pub identifier: Vec<u8>,
    pub key_hash: u64,
    pub is_redis: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHeader {
    pub name: String,
    pub value: String,
}

/// Evaluation decision output from Connection Limit Access phase.
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
