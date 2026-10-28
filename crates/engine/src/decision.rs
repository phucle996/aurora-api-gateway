//! Common types, limits, decisions, and host utilities for Aurora Engine.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_POLICY_BYTES: usize = 65_536;
pub const MAX_PATH_BYTES: usize = 8_192;

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidPolicy,
    InvalidRequest,
}

/// Decision output struct compatible with C ABI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct Decision {
    pub generation: u64,
    pub rule_id: u64,
    pub action: u32,
    pub score: u32,
    pub log_matches: u32,
    pub reserved: u32,
}

/// Token representing an acquired in-flight connection slot for rate/connection limiting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConnectionToken {
    pub is_redis: bool,
    pub rule_id: String,
    pub identifier: String,
}

/// Consolidated outcome of Gateway Access evaluation with zero-copy borrowed string/buffer slices.
///
/// Returned directly to NGINX for execution:
/// - `Allow`: NGINX sets headers, upstream, limit_rate and forwards to upstream
/// - `Deny`: NGINX short-circuits request with status, www_authenticate, content_type, body
#[derive(Debug, PartialEq, Eq)]
pub enum AccessDecision<'a> {
    Allow {
        forwarded_headers: Arc<[(String, String)]>,
        target_upstream: Option<&'a str>,
        rate_limit_bytes_per_sec: u64,
        conn_token: Option<ConnectionToken>,
    },
    Deny {
        status: u16,
        www_authenticate: bool,
        content_type: Option<&'a str>,
        body: Option<&'a [u8]>,
    },
}

/// Compact representation of an Access Phase rejection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccessDenial<'a> {
    pub status: u16,
    pub www_authenticate: bool,
    pub content_type: Option<&'a str>,
    pub body: Option<&'a [u8]>,
}

impl<'a> From<AccessDenial<'a>> for AccessDecision<'a> {
    #[inline]
    fn from(d: AccessDenial<'a>) -> Self {
        AccessDecision::Deny {
            status: d.status,
            www_authenticate: d.www_authenticate,
            content_type: d.content_type,
            body: d.body,
        }
    }
}

/// Returns the current timestamp in UNIX nanoseconds.
#[inline]
pub fn current_unix_nano() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

pub fn host_specificity(host: &str) -> u8 {
    if host == "*" {
        2
    } else if host.starts_with("*.") {
        1
    } else {
        0
    }
}

pub fn host_matches(scope_host: &[u8], req_host: &[u8]) -> bool {
    if scope_host == b"*" {
        return true;
    }
    if let Some(rest) = scope_host.strip_prefix(b"*.") {
        if req_host.eq_ignore_ascii_case(rest) {
            return true;
        }
        let dot_suffix = &scope_host[1..];
        if req_host.len() > dot_suffix.len() {
            let suffix = &req_host[req_host.len() - dot_suffix.len()..];
            if suffix.eq_ignore_ascii_case(dot_suffix) {
                return true;
            }
        }
        return false;
    }
    scope_host.eq_ignore_ascii_case(req_host)
}
