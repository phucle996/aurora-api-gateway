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
pub const MAX_FORWARD_HEADERS_PER_ORIGIN: usize = 32;
pub const MAX_AUTHORIZATION_BYTES: usize = 16_384;

#[derive(Deserialize)]
pub(crate) struct Snapshot {
    pub(crate) schema_version: u32,
    pub(crate) generation: u64,
    #[serde(default)]
    pub(crate) origins: Vec<OriginInput>,
    #[serde(default)]
    pub(crate) rules: Vec<OriginInput>,
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

#[derive(Deserialize)]
pub(crate) struct OriginInput {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) priority: u32,
    #[serde(default)]
    pub(crate) origin: String,
    #[serde(default)]
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
    #[serde(default)]
    pub(crate) require_exp: bool,
    #[serde(default)]
    pub(crate) validate_nbf: bool,
    #[serde(default)]
    pub(crate) clock_skew_secs: u64,
    #[serde(default)]
    pub(crate) claim_rules: Vec<ClaimRuleInput>,
    #[serde(default)]
    pub(crate) forward_headers: Vec<ForwardHeaderInput>,
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
}

/// Configured source location for JWT token extraction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TokenSource {
    /// Extract token from an HTTP header.
    Header {
        /// Header name (e.g. "Authorization" or "X-Auth-Token").
        name: String,
        /// Optional prefix to strip (e.g. "Bearer ").
        prefix: Option<String>,
    },
    /// Extract token from an HTTP Cookie.
    Cookie {
        /// Cookie name (e.g. "access_token" or "session").
        name: String,
        /// Optional prefix to strip.
        prefix: Option<String>,
    },
}

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
    pub(crate) fn host(&self) -> &str {
        if !self.origin.is_empty() {
            &self.origin
        } else {
            &self.host
        }
    }

    pub(crate) fn compile_token_source(&mut self) -> Result<TokenSource, Error> {
        let is_valid_name = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };

        if let Some(ts) = self.token_source.take() {
            match ts {
                TokenSourceInput::Type(t) => match t.trim().to_ascii_lowercase().as_str() {
                    "cookie" => {
                        if self.header_name.is_some() {
                            return Err(Error::InvalidPolicy);
                        }
                        let name = self.cookie_name.take().unwrap_or_default();
                        let trimmed = name.trim();
                        if !is_valid_name(trimmed) {
                            return Err(Error::InvalidPolicy);
                        }
                        let prefix = self.token_prefix.take().filter(|p| !p.is_empty());
                        Ok(TokenSource::Cookie {
                            name: if trimmed.len() == name.len() {
                                name
                            } else {
                                trimmed.to_string()
                            },
                            prefix,
                        })
                    }
                    "header" => {
                        if self.cookie_name.is_some() {
                            return Err(Error::InvalidPolicy);
                        }
                        let name = self.header_name.take().unwrap_or_default();
                        let trimmed = name.trim();
                        if !is_valid_name(trimmed) {
                            return Err(Error::InvalidPolicy);
                        }
                        let prefix = if let Some(p) = self.token_prefix.take() {
                            if p.len() > 64 {
                                return Err(Error::InvalidPolicy);
                            }
                            if p.is_empty() { None } else { Some(p) }
                        } else {
                            None
                        };
                        Ok(TokenSource::Header {
                            name: if trimmed.len() == name.len() {
                                name
                            } else {
                                trimmed.to_string()
                            },
                            prefix,
                        })
                    }
                    _ => Err(Error::InvalidPolicy),
                },
                TokenSourceInput::Config {
                    source_type,
                    name,
                    prefix,
                } => match source_type.trim().to_ascii_lowercase().as_str() {
                    "cookie" => {
                        if self.header_name.is_some() {
                            return Err(Error::InvalidPolicy);
                        }
                        let c_name = name.or(self.cookie_name.take()).unwrap_or_default();
                        let trimmed = c_name.trim();
                        if !is_valid_name(trimmed) {
                            return Err(Error::InvalidPolicy);
                        }
                        let pref = prefix
                            .or(self.token_prefix.take())
                            .filter(|p| !p.is_empty());
                        Ok(TokenSource::Cookie {
                            name: if trimmed.len() == c_name.len() {
                                c_name
                            } else {
                                trimmed.to_string()
                            },
                            prefix: pref,
                        })
                    }
                    "header" => {
                        if self.cookie_name.is_some() {
                            return Err(Error::InvalidPolicy);
                        }
                        let h_name = name.or(self.header_name.take()).unwrap_or_default();
                        let trimmed = h_name.trim();
                        if !is_valid_name(trimmed) {
                            return Err(Error::InvalidPolicy);
                        }
                        let pref = if let Some(p) = prefix.or(self.token_prefix.take()) {
                            if p.len() > 64 {
                                return Err(Error::InvalidPolicy);
                            }
                            if p.is_empty() { None } else { Some(p) }
                        } else {
                            None
                        };
                        Ok(TokenSource::Header {
                            name: if trimmed.len() == h_name.len() {
                                h_name
                            } else {
                                trimmed.to_string()
                            },
                            prefix: pref,
                        })
                    }
                    _ => Err(Error::InvalidPolicy),
                },
            }
        } else {
            // Strict invariant: token_source must be explicitly configured
            Err(Error::InvalidPolicy)
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

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct ForwardHeaderInput {
    pub(crate) payload_key: String,
    pub(crate) header_key: String,
    #[serde(default = "default_match_all")]
    pub(crate) value: String,
}

pub(crate) fn default_match_all() -> String {
    "*".to_string()
}

pub struct ForwardedHeader {
    pub name: String,
    pub value: String,
}

pub(crate) struct CompiledClaimRule {
    pub(crate) payload_key: String,
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
    pub(crate) require_exp: bool,
    pub(crate) validate_nbf: bool,
    pub(crate) clock_skew_secs: u64,
    pub(crate) claim_rules: Vec<CompiledClaimRule>,
    pub(crate) cache: Option<Arc<JwtCache>>,
    pub(crate) token_source: TokenSource,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JwtDecision {
    Allow {
        forwarded_headers: Arc<[(String, String)]>,
    },
    Unauthorized,
}
