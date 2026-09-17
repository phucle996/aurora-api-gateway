//! Common types, limits, and host utilities for Aurora Engine.

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
