use crate::Error;
use regex::Regex;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

use super::cache::JwtCache;
use super::crypto::{JwtAlgorithm, VerifierKey};
use super::exclude::ExcludeMatcher;

pub const MAX_JWT_POLICY_BYTES: usize = 131_072;
pub const MAX_JWT_ORIGINS: usize = 16;
pub const MAX_JWT_KEYS_PER_ORIGIN: usize = 8;
pub const MAX_EXCLUDE_PATHS_PER_ORIGIN: usize = 32;
pub const MAX_CLAIM_RULES_PER_ORIGIN: usize = 32;
pub const MAX_FORWARD_HEADERS_PER_ORIGIN: usize = 16;
pub const MAX_AUTHORIZATION_BYTES: usize = 16_384;

fn default_schema_version() -> u32 {
    1
}

#[derive(Deserialize)]
pub(crate) struct Snapshot {
    #[serde(default = "default_schema_version")]
    pub(crate) schema_version: u32,
    #[serde(default)]
    pub(crate) generation: u64,
    #[serde(default, alias = "rules")]
    pub(crate) origins: Vec<OriginInput>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct CacheConfigInput {
    #[serde(default = "default_cache_enabled")]
    pub(crate) enabled: bool,
    #[serde(default = "default_cache_shards")]
    pub(crate) shards: usize,
    #[serde(default = "default_max_entries_per_shard")]
    pub(crate) max_entries_per_shard: usize,
    #[serde(default = "default_ttl_secs")]
    pub(crate) default_ttl_secs: u64,
    #[serde(default = "default_negative_ttl_secs")]
    pub(crate) negative_ttl_secs: u64,
}

impl Default for CacheConfigInput {
    fn default() -> Self {
        Self {
            enabled: true,
            shards: default_cache_shards(),
            max_entries_per_shard: default_max_entries_per_shard(),
            default_ttl_secs: default_ttl_secs(),
            negative_ttl_secs: default_negative_ttl_secs(),
        }
    }
}

pub(crate) fn default_cache_enabled() -> bool {
    true
}

pub(crate) fn default_cache_shards() -> usize {
    let cores = crate::hardware::cpu_cores();
    // Hardware-adaptive shard sizing local to JWT plugin:
    // Multiplier 4x prevents the Birthday Paradox lock collision on parking_lot::RwLock
    // when threads on different cores randomly hash to shards under high load.
    // Clamped to [16, 1024] and rounded up to next power of 2 for 1-cycle bitwise masking (`& (shards - 1)`).
    (cores * 4).clamp(16, 1024).next_power_of_two()
}

pub(crate) fn default_max_entries_per_shard() -> usize {
    // 1024 entries per shard keeps each shard's FxHashMap bucket array under ~16KB,
    // fitting 100% inside the CPU core's L1 Data Cache (32-48KB) for 1ns lookup latency.
    // Total gateway cache capacity scales linearly with core count: shards * max_entries.
    1024
}

pub(crate) fn default_ttl_secs() -> u64 {
    300
}

pub(crate) fn default_negative_ttl_secs() -> u64 {
    30
}

#[derive(Deserialize, Clone, Debug, Default)]
pub(crate) struct RedisTlsConfigInput {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) ca_cert_pem: Option<String>,
    #[serde(default)]
    pub(crate) client_cert_pem: Option<String>,
    #[serde(default)]
    pub(crate) client_key_pem: Option<String>,
    #[serde(default)]
    pub(crate) insecure_skip_verify: bool,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub(crate) struct RedisConfigInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) password: Option<String>,
    #[serde(default)]
    pub(crate) db: Option<i64>,
    #[serde(default = "default_redis_timeout_ms")]
    pub(crate) timeout_ms: u64,
    #[serde(default = "default_redis_pool_size")]
    pub(crate) pool_size: usize,
    #[serde(default)]
    pub(crate) tls: Option<RedisTlsConfigInput>,
}

pub(crate) fn default_redis_timeout_ms() -> u64 {
    50
}

pub(crate) fn default_redis_pool_size() -> usize {
    8
}

#[derive(Deserialize)]
pub(crate) struct OriginInput {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) priority: u32,
    #[serde(default, alias = "origin")]
    pub(crate) host: String,
    pub(crate) path_prefix: String,
    #[serde(default)]
    pub(crate) exclude_paths: Vec<String>,
    pub(crate) algorithm: String,
    #[serde(default)]
    pub(crate) secret: String,
    #[serde(default)]
    pub(crate) public_key_pem: String,
    #[serde(default)]
    pub(crate) keys: Vec<KeyInput>,
    #[serde(default)]
    pub(crate) issuer: String,
    #[serde(default)]
    pub(crate) audience: String,
    #[serde(default = "default_validate_exp")]
    pub(crate) validate_exp: bool,
    #[serde(default)]
    pub(crate) require_exp: bool,
    #[serde(default)]
    pub(crate) validate_nbf: bool,
    #[serde(default = "default_payload_format")]
    pub(crate) payload_format: String,
    #[serde(default)]
    pub(crate) clock_skew_secs: u64,
    #[serde(default)]
    pub(crate) claim_rules: Vec<ClaimRuleInput>,
    #[serde(default)]
    pub(crate) cache: Option<CacheConfigInput>,
    #[serde(default)]
    pub(crate) token_source: Option<TokenSourceInput>,
    #[serde(default)]
    pub(crate) header_name: Option<String>,
    #[serde(default)]
    pub(crate) cookie_name: Option<String>,
    #[serde(default)]
    pub(crate) token_prefix: Option<String>,
    #[serde(default)]
    pub(crate) revoked_tokens: Vec<String>,
    #[serde(default)]
    pub(crate) revoked_jtis: Vec<String>,
    #[serde(default)]
    pub(crate) redis: Option<RedisConfigInput>,
}

/// Target location for extracting the raw JWT token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenLocation {
    Header(String),
    Cookie(Box<[u8]>),
}

pub type TokenSource = TokenLocation;

#[derive(Deserialize, Clone, Debug)]
#[serde(untagged)]
pub(crate) enum TokenSourceInput {
    Type(String),
    Config {
        #[serde(rename = "type", default = "default_token_source_type")]
        source_type: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        prefix: Option<String>,
    },
}

fn default_token_source_type() -> String {
    "header".to_string()
}

impl OriginInput {
    pub(crate) fn compile_token_source(&mut self) -> Result<(TokenLocation, Box<[u8]>), Error> {
        let is_valid_name = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };

        let (src_type, custom_name, custom_prefix) = match self.token_source.take() {
            Some(TokenSourceInput::Type(t)) => (t, None, None),
            Some(TokenSourceInput::Config {
                source_type,
                name,
                prefix,
            }) => (source_type, name, prefix),
            None => return Err(Error::InvalidPolicy),
        };

        let prefix_bytes = custom_prefix
            .or_else(|| self.token_prefix.take())
            .unwrap_or_default()
            .into_bytes()
            .into_boxed_slice();

        if prefix_bytes.len() > 64 {
            return Err(Error::InvalidPolicy);
        }

        match src_type.trim() {
            "header" => {
                if self.cookie_name.is_some() {
                    return Err(Error::InvalidPolicy);
                }
                let name = custom_name.or_else(|| self.header_name.take()).unwrap_or_default();
                let trimmed = name.trim();
                if !is_valid_name(trimmed) {
                    return Err(Error::InvalidPolicy);
                }
                Ok((TokenLocation::Header(trimmed.to_string()), prefix_bytes))
            }
            "cookie" => {
                if self.header_name.is_some() {
                    return Err(Error::InvalidPolicy);
                }
                let name = custom_name.or_else(|| self.cookie_name.take()).unwrap_or_default();
                let trimmed = name.trim();
                if !is_valid_name(trimmed) {
                    return Err(Error::InvalidPolicy);
                }
                Ok((
                    TokenLocation::Cookie(trimmed.as_bytes().to_vec().into_boxed_slice()),
                    prefix_bytes,
                ))
            }
            _ => Err(Error::InvalidPolicy),
        }
    }
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct KeyInput {
    #[serde(default)]
    pub(crate) kid: String,
    #[serde(default)]
    pub(crate) public_key_pem: String,
    #[serde(default)]
    pub(crate) secret: String,
    #[serde(default)]
    pub(crate) is_primary: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct ClaimRuleInput {
    pub(crate) payload_key: String,
    #[serde(default = "default_match_all")]
    pub(crate) values_match: String,
    #[serde(default)]
    pub(crate) header_key: Option<String>,
    #[serde(default)]
    pub(crate) required: bool,
}

pub(crate) fn default_match_all() -> String {
    "*".to_string()
}

pub(crate) fn default_validate_exp() -> bool {
    true
}

pub(crate) fn default_payload_format() -> String {
    "json".to_string()
}

/// Explicit format of the JWT payload body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayloadFormat {
    /// Standard JSON object with nested/primitive claim keys.
    Json,
    /// Custom plain text / delimited raw payload with regex capture extractor.
    Raw,
}

pub(crate) struct CompiledClaimRule {
    pub(crate) payload_key: String,
    pub(crate) raw_extractor: Option<Regex>,
    pub(crate) regex: Option<Regex>,
    pub(crate) header_key: Option<String>,
    pub(crate) required: bool,
}

pub(crate) struct OriginPolicy {
    pub(crate) host: Vec<u8>,
    pub(crate) exclude_matcher: ExcludeMatcher,
    pub(crate) algorithm: JwtAlgorithm,
    pub(crate) primary_key: VerifierKey,
    pub(crate) keys_by_kid: HashMap<String, VerifierKey>,
    pub(crate) issuer: Option<String>,
    pub(crate) audience: Option<String>,
    pub(crate) payload_format: PayloadFormat,
    pub(crate) validate_exp: bool,
    pub(crate) require_exp: bool,
    pub(crate) validate_nbf: bool,
    pub(crate) clock_skew_secs: u64,
    pub(crate) claim_rules: Vec<CompiledClaimRule>,
    pub(crate) cache: Option<Arc<JwtCache>>,
    pub(crate) token_location: TokenLocation,
    pub(crate) token_prefix: Box<[u8]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JwtDecision {
    Allow {
        forwarded_headers: Arc<[(String, String)]>,
    },
    Unauthorized,
}
