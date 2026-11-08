//! Flat Declarative Policy Schema & Validation for JWT Authentication (Slot 1).
//!
//! Enforces zero-allocation parsing, strict schema validation, and bounded invariants
//! for in-process JWT authentication (HS256..512, RS256..512, ES256/384, EdDSA).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use regex::Regex;
use serde::{Deserialize, Serialize};

use super::cache::JwtCache;
use super::crypto::{JwtAlgorithm, VerifierKey, valid_host, valid_path_prefix};
use super::exclude::ExcludeMatcher;
use crate::Error;

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

fn default_generation() -> u64 {
    1
}

fn default_cache_enabled() -> bool {
    true
}

pub(crate) fn default_cache_shards() -> usize {
    let cores = crate::hardware::cpu_cores();
    (cores * 4).clamp(16, 1024).next_power_of_two()
}

pub(crate) fn default_max_entries_per_shard() -> usize {
    1024
}

pub(crate) fn default_ttl_secs() -> u64 {
    300
}

pub(crate) fn default_negative_ttl_secs() -> u64 {
    30
}

fn default_redis_timeout_ms() -> u64 {
    50
}

fn default_redis_pool_size() -> usize {
    8
}

fn default_token_source_type() -> String {
    "header".to_string()
}

fn default_match_all() -> String {
    "*".to_string()
}

fn default_validate_exp() -> bool {
    true
}

fn default_payload_format() -> String {
    "json".to_string()
}

// ---------------------------------------------------------------------------
// 1. Declarative Policy Schema
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JwtPolicy {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default = "default_generation")]
    pub generation: u64,
    #[serde(default, alias = "rules")]
    pub origins: Vec<OriginPolicyInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OriginPolicyInput {
    pub id: String,
    #[serde(default)]
    pub priority: u32,
    #[serde(default, alias = "origin")]
    pub host: String,
    pub path_prefix: String,
    #[serde(default)]
    pub exclude_paths: Vec<String>,
    pub algorithm: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub public_key_pem: String,
    #[serde(default)]
    pub keys: Vec<KeyInput>,
    #[serde(default)]
    pub issuer: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default = "default_validate_exp")]
    pub validate_exp: bool,
    #[serde(default)]
    pub require_exp: bool,
    #[serde(default)]
    pub validate_nbf: bool,
    #[serde(default = "default_payload_format")]
    pub payload_format: String,
    #[serde(default)]
    pub clock_skew_secs: u64,
    #[serde(default)]
    pub claim_rules: Vec<ClaimRuleInput>,
    #[serde(default)]
    pub cache: Option<CacheConfigInput>,
    #[serde(default)]
    pub token_source: Option<TokenSourceInput>,
    #[serde(default)]
    pub header_name: Option<String>,
    #[serde(default)]
    pub cookie_name: Option<String>,
    #[serde(default)]
    pub token_prefix: Option<String>,
    #[serde(default)]
    pub revoked_tokens: Vec<String>,
    #[serde(default)]
    pub revoked_jtis: Vec<String>,
    #[serde(default)]
    pub redis: Option<RedisConfigInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyInput {
    #[serde(default)]
    pub kid: String,
    #[serde(default)]
    pub public_key_pem: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimRuleInput {
    pub payload_key: String,
    #[serde(default = "default_match_all")]
    pub values_match: String,
    #[serde(default)]
    pub header_key: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CacheConfigInput {
    #[serde(default = "default_cache_enabled")]
    pub enabled: bool,
    #[serde(default = "default_cache_shards")]
    pub shards: usize,
    #[serde(default = "default_max_entries_per_shard")]
    pub max_entries_per_shard: usize,
    #[serde(default = "default_ttl_secs")]
    pub default_ttl_secs: u64,
    #[serde(default = "default_negative_ttl_secs")]
    pub negative_ttl_secs: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TokenSourceInput {
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct RedisConfigInput {
    #[serde(default)]
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
    pub tls: Option<RedisTlsConfigInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct RedisTlsConfigInput {
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

// ---------------------------------------------------------------------------
// 2. Runtime Enums & Structs
// ---------------------------------------------------------------------------

/// Target location for extracting the raw JWT token.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenLocation {
    Header(String),
    Cookie(Box<[u8]>),
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

/// Pre-compiled arithmetic token prefix guard.
///
/// Converts string `starts_with` into a single 64-bit masked integer comparison (1 ALU cycle).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TokenPrefixGuard {
    pub(crate) len: usize,
    pub(crate) head_u64: u64,
    pub(crate) mask_u64: u64,
    pub(crate) tail: Box<[u8]>,
}

impl TokenPrefixGuard {
    pub(crate) fn compile(prefix: &[u8]) -> Self {
        let len = prefix.len();
        if len == 0 {
            return Self {
                len: 0,
                head_u64: 0,
                mask_u64: 0,
                tail: Box::new([]),
            };
        }
        let head_len = len.min(8);
        let mut buf = [0u8; 8];
        buf[..head_len].copy_from_slice(&prefix[..head_len]);
        let head_u64 = u64::from_le_bytes(buf);

        let mut mask_buf = [0u8; 8];
        mask_buf[..head_len].fill(0xFF);
        let mask_u64 = u64::from_le_bytes(mask_buf);

        let tail = if len > 8 {
            prefix[8..].to_vec().into_boxed_slice()
        } else {
            Box::new([])
        };

        Self {
            len,
            head_u64,
            mask_u64,
            tail,
        }
    }

    #[inline(always)]
    pub(crate) fn matches(&self, input: &[u8]) -> bool {
        if input.len() < self.len {
            return false;
        }
        if self.len == 0 {
            return true;
        }
        if self.len <= 8 {
            if input.len() >= 8 {
                let chunk = u64::from_le_bytes(input[..8].try_into().unwrap());
                (chunk & self.mask_u64) == self.head_u64
            } else {
                let mut buf = [0u8; 8];
                buf[..input.len()].copy_from_slice(input);
                let chunk = u64::from_le_bytes(buf);
                (chunk & self.mask_u64) == self.head_u64
            }
        } else {
            let chunk = u64::from_le_bytes(input[..8].try_into().unwrap());
            if (chunk & self.mask_u64) != self.head_u64 {
                return false;
            }
            &input[8..self.len] == self.tail.as_ref()
        }
    }
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
    pub(crate) token_prefix: TokenPrefixGuard,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JwtDecision {
    Allow {
        forwarded_headers: Arc<[(String, String)]>,
    },
    Unauthorized,
}

// ---------------------------------------------------------------------------
// 3. Methods & Validation Invariants
// ---------------------------------------------------------------------------

impl JwtPolicy {
    /// Validates all declarative invariants for the JWT policy.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schema_version: {}, expected 1",
                self.schema_version
            ));
        }

        if self.origins.is_empty() {
            return Err("origins list cannot be empty".to_string());
        }

        if self.origins.len() > MAX_JWT_ORIGINS {
            return Err(format!(
                "too many origins: {} > max {}",
                self.origins.len(),
                MAX_JWT_ORIGINS
            ));
        }

        let mut ids = HashSet::with_capacity(self.origins.len());
        for origin in &self.origins {
            let id = origin.id.trim();
            if id.is_empty() || id.len() > 128 {
                return Err(format!("invalid origin id '{}'", origin.id));
            }
            if !ids.insert(id) {
                return Err(format!("duplicate origin id '{}'", origin.id));
            }

            if !valid_host(&origin.host) {
                return Err(format!("invalid host '{}' in origin '{}'", origin.host, id));
            }

            if !valid_path_prefix(&origin.path_prefix) {
                return Err(format!(
                    "invalid path_prefix '{}' in origin '{}'",
                    origin.path_prefix, id
                ));
            }

            if origin.exclude_paths.len() > MAX_EXCLUDE_PATHS_PER_ORIGIN {
                return Err(format!(
                    "too many exclude_paths: {} > max {} in origin '{}'",
                    origin.exclude_paths.len(),
                    MAX_EXCLUDE_PATHS_PER_ORIGIN,
                    id
                ));
            }

            if origin.issuer.len() > 512 {
                return Err(format!("issuer exceeds 512 bytes in origin '{}'", id));
            }

            if origin.audience.len() > 512 {
                return Err(format!("audience exceeds 512 bytes in origin '{}'", id));
            }

            if origin.clock_skew_secs > 300 {
                return Err(format!("clock_skew_secs exceeds 300 in origin '{}'", id));
            }

            match origin.payload_format.trim() {
                "json" | "raw" => {}
                other => {
                    return Err(format!(
                        "unsupported payload_format '{}' in origin '{}'",
                        other, id
                    ));
                }
            }

            if origin.algorithm.trim().parse::<JwtAlgorithm>().is_err() {
                return Err(format!(
                    "unsupported algorithm '{}' in origin '{}'",
                    origin.algorithm, id
                ));
            }

            if origin.keys.len() > MAX_JWT_KEYS_PER_ORIGIN {
                return Err(format!(
                    "too many keys: {} > max {} in origin '{}'",
                    origin.keys.len(),
                    MAX_JWT_KEYS_PER_ORIGIN,
                    id
                ));
            }

            if origin.claim_rules.len() > MAX_CLAIM_RULES_PER_ORIGIN {
                return Err(format!(
                    "too many claim_rules: {} > max {} in origin '{}'",
                    origin.claim_rules.len(),
                    MAX_CLAIM_RULES_PER_ORIGIN,
                    id
                ));
            }

            let mut fwd_count = 0;
            for cr in &origin.claim_rules {
                if cr.payload_key.trim().is_empty() || cr.payload_key.len() > 64 {
                    return Err(format!(
                        "invalid claim payload_key '{}' in origin '{}'",
                        cr.payload_key, id
                    ));
                }
                if let Some(ref hk) = cr.header_key {
                    let trimmed_hk = hk.trim();
                    if trimmed_hk.is_empty()
                        || trimmed_hk.len() > 64
                        || !trimmed_hk
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    {
                        return Err(format!(
                            "invalid claim header_key '{}' in origin '{}'",
                            hk, id
                        ));
                    }
                    fwd_count += 1;
                }
                if cr.values_match != "*"
                    && !cr.values_match.trim().is_empty()
                    && Regex::new(&cr.values_match).is_err()
                {
                    return Err(format!(
                        "invalid regex values_match '{}' in origin '{}'",
                        cr.values_match, id
                    ));
                }
            }

            if fwd_count > MAX_FORWARD_HEADERS_PER_ORIGIN {
                return Err(format!(
                    "too many forward headers: {} > max {} in origin '{}'",
                    fwd_count, MAX_FORWARD_HEADERS_PER_ORIGIN, id
                ));
            }

            origin
                .compile_token_source()
                .map_err(|e| format!("token_source error in origin '{}': {e:?}", id))?;
        }

        Ok(())
    }
}

impl OriginPolicyInput {
    /// Compiles and validates the token source location and prefix without mutating `self`.
    pub fn compile_token_source(&self) -> Result<(TokenLocation, Box<[u8]>), Error> {
        let is_valid_name = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };

        let (src_type, custom_name, custom_prefix) = match &self.token_source {
            Some(TokenSourceInput::Type(t)) => (t.as_str(), None, None),
            Some(TokenSourceInput::Config {
                source_type,
                name,
                prefix,
            }) => (source_type.as_str(), name.as_deref(), prefix.as_deref()),
            None => return Err(Error::InvalidPolicy),
        };

        let prefix_bytes = custom_prefix
            .or(self.token_prefix.as_deref())
            .unwrap_or_default()
            .as_bytes()
            .to_vec()
            .into_boxed_slice();

        if prefix_bytes.len() > 64 {
            return Err(Error::InvalidPolicy);
        }

        match src_type.trim() {
            "header" => {
                if self.cookie_name.is_some() {
                    return Err(Error::InvalidPolicy);
                }
                let name = custom_name
                    .or(self.header_name.as_deref())
                    .unwrap_or_default();
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
                let name = custom_name
                    .or(self.cookie_name.as_deref())
                    .unwrap_or_default();
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
