//! Flat In-Memory Rule Models for Fast IP Matching
//!
//! Encapsulates pre-calculated subnet masks, method bitmasks, and host/path
//! matchers for zero-allocation hot path evaluation.

pub const METHOD_GET: u16 = 1 << 0;
pub const METHOD_HEAD: u16 = 1 << 1;
pub const METHOD_POST: u16 = 1 << 2;
pub const METHOD_PUT: u16 = 1 << 3;
pub const METHOD_DELETE: u16 = 1 << 4;
pub const METHOD_CONNECT: u16 = 1 << 5;
pub const METHOD_OPTIONS: u16 = 1 << 6;
pub const METHOD_TRACE: u16 = 1 << 7;
pub const METHOD_PATCH: u16 = 1 << 8;
pub const METHOD_ALL: u16 = 0xFFFF;

#[inline(always)]
pub fn method_to_mask(method: &[u8]) -> u16 {
    if method == b"*" {
        METHOD_ALL
    } else if method.eq_ignore_ascii_case(b"GET") {
        METHOD_GET
    } else if method.eq_ignore_ascii_case(b"POST") {
        METHOD_POST
    } else if method.eq_ignore_ascii_case(b"PUT") {
        METHOD_PUT
    } else if method.eq_ignore_ascii_case(b"DELETE") {
        METHOD_DELETE
    } else if method.eq_ignore_ascii_case(b"HEAD") {
        METHOD_HEAD
    } else if method.eq_ignore_ascii_case(b"OPTIONS") {
        METHOD_OPTIONS
    } else if method.eq_ignore_ascii_case(b"PATCH") {
        METHOD_PATCH
    } else if method.eq_ignore_ascii_case(b"CONNECT") {
        METHOD_CONNECT
    } else if method.eq_ignore_ascii_case(b"TRACE") {
        METHOD_TRACE
    } else {
        0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostMatcher {
    Any,
    Exact(Vec<u8>),
    Suffix(Vec<u8>),
}

impl HostMatcher {
    pub fn parse(host_str: &str) -> Option<Self> {
        let s = host_str.trim();
        if s == "*" || s.is_empty() {
            Some(HostMatcher::Any)
        } else if let Some(sub) = s.strip_prefix("*.") {
            if sub.is_empty()
                || !sub
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            {
                None
            } else {
                Some(HostMatcher::Suffix(sub.as_bytes().to_vec()))
            }
        } else {
            if !s
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            {
                None
            } else {
                Some(HostMatcher::Exact(s.as_bytes().to_vec()))
            }
        }
    }

    #[inline(always)]
    pub fn matches(&self, req_host: &[u8]) -> bool {
        match self {
            HostMatcher::Any => true,
            HostMatcher::Exact(expected) => expected.as_slice() == req_host,
            HostMatcher::Suffix(suffix) => {
                if req_host.len() <= suffix.len() {
                    false
                } else if req_host.ends_with(suffix) {
                    let dot_pos = req_host.len() - suffix.len() - 1;
                    req_host[dot_pos] == b'.'
                } else {
                    false
                }
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct FlatIpv4Rule {
    pub mask: u32,
    pub network: u32,
    pub prefix_len: u8,
    pub priority: u32,
    pub is_block: bool,
    pub rule_id: u64,
    pub method_mask: u16,
    pub host: HostMatcher,
    pub path_prefix: Vec<u8>,
    pub log: bool,
}

impl FlatIpv4Rule {
    #[inline(always)]
    pub fn matches(&self, ip: u32, req_method_mask: u16, host: &[u8], path: &[u8]) -> bool {
        // 1. Bitwise IP subnet match (AND + CMP)
        if (ip & self.mask) != self.network {
            return false;
        }

        // 2. HTTP method bitwise match (TEST)
        if (self.method_mask & req_method_mask) == 0 {
            return false;
        }

        // 3. Host match
        if !self.host.matches(host) {
            return false;
        }

        // 4. Path prefix match
        self.matches_path(path)
    }

    #[inline(always)]
    fn matches_path(&self, path: &[u8]) -> bool {
        if path.len() < self.path_prefix.len() {
            return false;
        }
        if !path.starts_with(&self.path_prefix) {
            return false;
        }
        if self.path_prefix == b"/" || self.path_prefix.ends_with(b"/") {
            return true;
        }
        path.len() == self.path_prefix.len() || path[self.path_prefix.len()] == b'/'
    }
}

#[derive(Clone, Debug)]
pub struct FlatIpv6Rule {
    pub mask: u128,
    pub network: u128,
    pub prefix_len: u8,
    pub priority: u32,
    pub is_block: bool,
    pub rule_id: u64,
    pub method_mask: u16,
    pub host: HostMatcher,
    pub path_prefix: Vec<u8>,
    pub log: bool,
}

impl FlatIpv6Rule {
    #[inline(always)]
    pub fn matches(&self, ip: u128, req_method_mask: u16, host: &[u8], path: &[u8]) -> bool {
        // 1. Bitwise IP subnet match (AND + CMP)
        if (ip & self.mask) != self.network {
            return false;
        }

        // 2. HTTP method bitwise match (TEST)
        if (self.method_mask & req_method_mask) == 0 {
            return false;
        }

        // 3. Host match
        if !self.host.matches(host) {
            return false;
        }

        // 4. Path prefix match
        self.matches_path(path)
    }

    #[inline(always)]
    fn matches_path(&self, path: &[u8]) -> bool {
        if path.len() < self.path_prefix.len() {
            return false;
        }
        if !path.starts_with(&self.path_prefix) {
            return false;
        }
        if self.path_prefix == b"/" || self.path_prefix.ends_with(b"/") {
            return true;
        }
        path.len() == self.path_prefix.len() || path[self.path_prefix.len()] == b'/'
    }
}
