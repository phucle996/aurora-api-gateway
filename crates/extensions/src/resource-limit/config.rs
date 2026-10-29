//! Declarative Snapshot Configuration and Request DTOs
//!
//! Provides deserialization models for `resource-limit` NodeSpec JSON snapshots
//! and request evaluation contexts.

use serde::Deserialize;

fn default_schema_version() -> u32 {
    1
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

fn default_rejected_code_header() -> u16 {
    431
}

fn default_rejected_code_payload() -> u16 {
    413
}

fn default_body_header() -> String {
    r#"{"error":"request_header_fields_too_large","message":"Request header exceeds limit"}"#
        .to_string()
}

fn default_body_payload() -> String {
    r#"{"error":"payload_too_large","message":"Payload size exceeds limit"}"#.to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct ResourceLimitRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,

    // Header Limit (max request-line + headers in bytes)
    #[serde(default)]
    pub header_limit: u64,

    // Payload Limit (max body content-length in bytes)
    #[serde(default)]
    pub payload_limit: u64,

    #[serde(default = "default_rejected_code_header")]
    pub rejected_code_header: u16,

    #[serde(default = "default_rejected_code_payload")]
    pub rejected_code_payload: u16,

    #[serde(default = "default_body_header")]
    pub response_body_header: String,

    #[serde(default = "default_body_payload")]
    pub response_body_payload: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct ResourceLimitSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<ResourceLimitRuleInput>,
}

#[derive(Clone, Copy, Debug)]
pub struct ResourceLimitRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub header_bytes: u64,
    pub payload_bytes: u64,
}

#[derive(Clone, Copy, Debug)]
pub struct ResourceLimitDecision<'a> {
    pub allowed: bool,
    pub status_code: u16,
    pub response_body: &'a [u8],
    pub rule_id: &'a str,
}

impl<'a> ResourceLimitDecision<'a> {
    #[inline(always)]
    pub const fn allow() -> ResourceLimitDecision<'static> {
        ResourceLimitDecision {
            allowed: true,
            status_code: 200,
            response_body: b"",
            rule_id: "",
        }
    }

    #[inline(always)]
    pub const fn reject(
        status_code: u16,
        response_body: &'a [u8],
        rule_id: &'a str,
    ) -> ResourceLimitDecision<'a> {
        ResourceLimitDecision {
            allowed: false,
            status_code,
            response_body,
            rule_id,
        }
    }
}
