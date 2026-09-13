use jsonwebtoken::{DecodingKey, Validation};
use regex::Regex;
use serde::Deserialize;
use std::collections::HashMap;

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

#[derive(Deserialize)]
pub(crate) struct OriginInput {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) priority: u32,
    #[serde(default)]
    pub(crate) origin: String,
    #[serde(default)]
    pub(crate) host: String,
    #[serde(default = "default_path_prefix")]
    pub(crate) path_prefix: String,
    #[serde(default)]
    pub(crate) exclude_paths: Vec<String>,
    #[serde(default = "default_algorithm")]
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
}

impl OriginInput {
    pub(crate) fn host(&self) -> &str {
        if !self.origin.is_empty() {
            &self.origin
        } else {
            &self.host
        }
    }
}

#[derive(Deserialize)]
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

#[derive(Deserialize)]
pub(crate) struct ForwardHeaderInput {
    pub(crate) payload_key: String,
    pub(crate) header_key: String,
    #[serde(default = "default_match_all")]
    pub(crate) value: String,
}

pub(crate) fn default_path_prefix() -> String {
    "/".to_string()
}

pub(crate) fn default_algorithm() -> String {
    "RS256".to_string()
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
    pub(crate) path_prefix: Vec<u8>,
    pub(crate) exclude_paths: Vec<Vec<u8>>,
    pub(crate) validation: Validation,
    pub(crate) primary_key: DecodingKey,
    pub(crate) keys_by_kid: HashMap<String, DecodingKey>,
    pub(crate) claim_rules: Vec<CompiledClaimRule>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JwtDecision {
    Allow {
        forwarded_headers: Vec<(String, String)>,
    },
    Unauthorized,
}
