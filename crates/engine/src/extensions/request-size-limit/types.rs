use regex::Regex;
use serde::{Deserialize, Serialize};

pub const MAX_REQUEST_SIZE_RULES: usize = 64;
pub const MAX_REQUEST_SIZE_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LimitBy {
    #[default]
    ClientIp,
    Header,
    RoutePath,
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestSizeRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default = "default_limit_by")]
    pub limit_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    #[serde(default = "default_match_value")]
    pub match_value: String,
    pub max_request_bytes: u64,
    #[serde(default)]
    pub max_header_bytes: u64,
    #[serde(default)]
    pub max_body_bytes: u64,
    #[serde(default = "default_rejected_code")]
    pub rejected_code: u16,
    #[serde(default = "default_response_body")]
    pub response_body: String,
}

fn default_priority() -> u32 {
    100
}
fn default_origin() -> String {
    "*".to_string()
}
fn default_path_prefix() -> String {
    "/".to_string()
}
fn default_limit_by() -> String {
    "client_ip".to_string()
}
fn default_match_value() -> String {
    "*".to_string()
}
fn default_rejected_code() -> u16 {
    413
}
fn default_response_body() -> String {
    r#"{"error":"payload_too_large","message":"Request size exceeds limit"}"#.to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestSizeSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<RequestSizeRuleInput>,
}

fn default_schema_version() -> u32 {
    1
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub origin: String,
    pub path_prefix: String,
    pub limit_by: LimitBy,
    pub header_name: Option<String>,
    pub is_wildcard: bool,
    pub regex: Option<Regex>,
    pub max_request_bytes: u64,
    pub max_header_bytes: u64,
    pub max_body_bytes: u64,
    pub rejected_code: u16,
    pub response_body: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub struct RequestSizeEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub client_ip: &'a [u8],
    pub header_bytes: u64,
    pub body_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestSizeDecision {
    pub allowed: bool,
    pub rejected_code: u16,
    pub response_body: Vec<u8>,
    pub matched: bool,
    pub rule_id: String,
}

impl RequestSizeDecision {
    pub fn allow() -> Self {
        Self {
            allowed: true,
            rejected_code: 0,
            response_body: Vec::new(),
            matched: false,
            rule_id: String::new(),
        }
    }

    pub fn allow_matched(rule_id: String) -> Self {
        Self {
            allowed: true,
            rejected_code: 0,
            response_body: Vec::new(),
            matched: true,
            rule_id,
        }
    }

    pub fn reject(rule_id: String, rejected_code: u16, response_body: Vec<u8>) -> Self {
        Self {
            allowed: false,
            rejected_code,
            response_body,
            matched: true,
            rule_id,
        }
    }
}
