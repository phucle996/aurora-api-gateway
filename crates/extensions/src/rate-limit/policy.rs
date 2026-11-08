//! Flat Declarative Policy Schema & Validation for Rate Limiting (Slot 2).
//!
//! Enforces zero-allocation parsing, strict schema validation, and bounded invariants
//! for in-process rate limiting (Token Bucket, Leaky Bucket, Fixed Window, Sliding Window).

use serde::{Deserialize, Serialize};

pub const NUM_SHARDS: usize = 16;
pub const MAX_RATE_LIMIT_RULES: usize = 64;
pub const MAX_RATE_LIMIT_POLICY_BYTES: usize = 131_072; // 128KB

fn default_schema_version() -> u32 {
    1
}

fn default_generation() -> u64 {
    1
}

fn default_redis_timeout_ms() -> u64 {
    10
}

fn default_redis_pool_size() -> usize {
    8
}

fn default_threshold_percent() -> u32 {
    20
}

fn default_min_delta_threshold() -> u32 {
    5
}

fn default_max_delta_threshold() -> u32 {
    100
}

// ---------------------------------------------------------------------------
// 1. Enums
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2. Transport Policy Inputs
// ---------------------------------------------------------------------------

#[derive(Deserialize, Serialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct TlsConfigInput {
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
pub struct RedisConfigInput {
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
    #[serde(default)]
    pub sync_interval_ms: u64,
    #[serde(default = "default_threshold_percent")]
    pub threshold_percent: u32,
    #[serde(default = "default_min_delta_threshold")]
    pub min_delta_threshold: u32,
    #[serde(default = "default_max_delta_threshold")]
    pub max_delta_threshold: u32,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct HeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RuleInput {
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

/// The flat policy snapshot for In-Process Rate Limiting (Slot 2).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct RateLimitPolicy {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_generation")]
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

// ---------------------------------------------------------------------------
// 3. Strict Schema Validation
// ---------------------------------------------------------------------------

impl RateLimitPolicy {
    /// Validates all invariants strictly. Rejects invalid configs with descriptive errors.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "Unsupported schema_version: expected 1, got {}",
                self.schema_version
            ));
        }

        if self.generation > i64::MAX as u64 {
            return Err("generation exceeds maximum allowed value".to_string());
        }

        if self.rules.is_empty() {
            return Err("rules cannot be empty".to_string());
        }

        if self.rules.len() > MAX_RATE_LIMIT_RULES {
            return Err(format!(
                "rules count ({}) exceeds maximum allowed ({})",
                self.rules.len(),
                MAX_RATE_LIMIT_RULES
            ));
        }

        // Memory budget bounds
        if self.memory_size_mb == 0 || self.memory_size_mb > 1024 {
            return Err(format!(
                "memory_size_mb ({}) must be between 1 and 1024",
                self.memory_size_mb
            ));
        }

        if self.max_keys < 16 || self.max_keys > 5_000_000 {
            return Err(format!(
                "max_keys ({}) must be between 16 and 5,000,000",
                self.max_keys
            ));
        }

        let mb_keys = (self.memory_size_mb as usize * 1024 * 1024) / 128;
        if self.max_keys > mb_keys {
            return Err(format!(
                "max_keys ({}) exceeds memory budget limit ({} keys)",
                self.max_keys, mb_keys
            ));
        }

        let max_keys_per_shard = self.max_keys / NUM_SHARDS;
        if max_keys_per_shard == 0 {
            return Err("max_keys_per_shard must be > 0".to_string());
        }

        // Rule invariants & deduplication
        let mut ids = std::collections::HashSet::with_capacity(self.rules.len());
        for rule in &self.rules {
            let id_trimmed = rule.id.trim();
            if id_trimmed.is_empty() || id_trimmed.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(format!("Invalid or duplicate rule ID: '{}'", rule.id));
            }

            if rule.rate == 0 {
                return Err(format!("Rule '{}': rate must be > 0", rule.id));
            }

            if rule.period_secs == 0 || rule.period_secs > 86400 {
                return Err(format!(
                    "Rule '{}': period_secs must be between 1 and 86400",
                    rule.id
                ));
            }

            if let Some(burst) = rule.burst {
                if burst == 0 {
                    return Err(format!("Rule '{}': burst cannot be 0", rule.id));
                }
                if burst < rule.rate {
                    return Err(format!(
                        "Rule '{}': burst ({}) cannot be less than rate ({})",
                        rule.id, burst, rule.rate
                    ));
                }
            }

            if rule.host.is_empty() || rule.host.len() > 253 {
                return Err(format!("Rule '{}': invalid host length", rule.id));
            }

            let host_valid = if rule.host == "*" {
                true
            } else if let Some(sub) = rule.host.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                rule.host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };

            if !host_valid {
                return Err(format!(
                    "Rule '{}': invalid host syntax '{}'",
                    rule.id, rule.host
                ));
            }

            if !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule.path_prefix.bytes().any(|b| b <= 32 || b >= 127)
            {
                return Err(format!(
                    "Rule '{}': invalid path_prefix '{}'",
                    rule.id, rule.path_prefix
                ));
            }

            match rule.limit_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" | "route_path" => {}
                "header" => {
                    let h_name = rule
                        .header_name
                        .as_ref()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .ok_or_else(|| {
                            format!("Rule '{}': header limit_by requires header_name", rule.id)
                        })?;
                    if h_name.len() > 64
                        || !h_name
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    {
                        return Err(format!(
                            "Rule '{}': invalid header_name '{}'",
                            rule.id, h_name
                        ));
                    }
                }
                _ => {
                    return Err(format!(
                        "Rule '{}': unsupported limit_by '{}'",
                        rule.id, rule.limit_by
                    ));
                }
            }

            if let Some(ref msg) = rule.custom_message
                && msg.len() > 2048
            {
                return Err(format!(
                    "Rule '{}': custom_message exceeds 2048 bytes",
                    rule.id
                ));
            }

            if let Some(code) = rule.rejected_code
                && !(200..=599).contains(&code)
            {
                return Err(format!(
                    "Rule '{}': rejected_code ({}) must be 200..=599",
                    rule.id, code
                ));
            }

            if let Some(ref headers) = rule.response_headers {
                if headers.len() > 8 {
                    return Err(format!(
                        "Rule '{}': response_headers count ({}) exceeds 8",
                        rule.id,
                        headers.len()
                    ));
                }
                for h in headers {
                    if h.name.trim().is_empty() || h.name.len() > 64 || h.value.len() > 256 {
                        return Err(format!(
                            "Rule '{}': invalid response header '{}'",
                            rule.id, h.name
                        ));
                    }
                }
            }
        }

        // Distributed mode requires valid redis configuration
        if self.mode == RateLimitMode::Distributed {
            let redis = self
                .redis
                .as_ref()
                .ok_or_else(|| "Distributed rate limiting requires redis config".to_string())?;
            if redis.endpoint.trim().is_empty() {
                return Err("Redis endpoint cannot be empty".to_string());
            }
            if redis.pool_size == 0 {
                return Err("Redis pool_size must be > 0".to_string());
            }
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 4. In-Memory Compiled Types & Decision
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompiledHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone)]
pub struct CompiledRule {
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
    pub emergency_delta_threshold: u32,
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
    #[inline]
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
