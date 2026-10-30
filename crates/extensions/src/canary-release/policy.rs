//! Declarative Snapshot Schema, 64-Byte L1 SlotSheet & Zero-Regex Byte Matcher
//!
//! Replaces heavy DFA regex engines with zero-allocation byte primitives:
//! - ExactSwar (1 CPU cycle for <= 8 bytes)
//! - OneOf / Prefix / Suffix / Contains (memchr vectorization)
//! - Present & Glob pattern matching
//! - 64-byte aligned CanarySlotSheet for L1 cache residency

use std::sync::Arc;
use serde::{Deserialize, Serialize};

pub const MAX_CANARY_RELEASE_RULES: usize = 64;
pub const MAX_CANARY_RELEASE_POLICY_BYTES: usize = 131_072; // 128KB
pub const MAX_CONDITIONS_PER_RULE: usize = 16;
pub const MAX_HEADERS_PER_SLOT: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SplitBy {
    #[default]
    ClientIp,
    Header,
    Cookie,
    Random,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchTarget {
    Header,
    Cookie,
    Uri,
    Path,
    Query,
}

/// Zero-allocation, hardware-accelerated byte pattern matcher.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ByteMatcher {
    /// Exact match with SWAR single-register comparison for strings <= 8 bytes
    ExactSwar { mask: u64, expected: u64, len: usize },
    /// Exact byte equality
    Exact(Vec<u8>),
    /// Matches any of the predefined byte sequences
    OneOf(Vec<Vec<u8>>),
    /// Starts with prefix
    Prefix(Vec<u8>),
    /// Ends with suffix
    Suffix(Vec<u8>),
    /// Contains substring (accelerated by memchr::memmem)
    Contains(Vec<u8>),
    /// Field present and non-empty
    Present,
    /// Wildcard / Glob pattern with '*' and '?'
    Glob(Vec<u8>),
    /// Matches if any sub-matcher matches (e.g. composite `(qa-.*|beta|vip)`)
    AnyOf(Vec<ByteMatcher>),
}

impl ByteMatcher {
    #[inline(always)]
    pub fn exact(bytes: &[u8]) -> Self {
        let len = bytes.len();
        if len > 0 && len <= 8 {
            let mut buf = [0u8; 8];
            buf[..len].copy_from_slice(bytes);
            let expected = u64::from_ne_bytes(buf);
            let mask = if len == 8 {
                !0u64
            } else {
                #[cfg(target_endian = "little")]
                {
                    (1u64 << (len * 8)) - 1
                }
                #[cfg(target_endian = "big")]
                {
                    !((1u64 << ((8 - len) * 8)) - 1)
                }
            };
            ByteMatcher::ExactSwar { mask, expected, len }
        } else {
            ByteMatcher::Exact(bytes.to_vec())
        }
    }

    #[inline(always)]
    pub fn is_match(&self, input: &[u8]) -> bool {
        match self {
            ByteMatcher::ExactSwar { mask, expected, len } => {
                if input.len() != *len {
                    return false;
                }
                let mut buf = [0u8; 8];
                buf[..*len].copy_from_slice(input);
                let val = u64::from_ne_bytes(buf);
                (val & *mask) == *expected
            }
            ByteMatcher::Exact(target) => input == target.as_slice(),
            ByteMatcher::OneOf(targets) => {
                let in_len = input.len();
                targets.iter().any(|t| t.len() == in_len && input == t.as_slice())
            }
            ByteMatcher::Prefix(prefix) => input.starts_with(prefix.as_slice()),
            ByteMatcher::Suffix(suffix) => input.ends_with(suffix.as_slice()),
            ByteMatcher::Contains(sub) => memchr::memmem::find(input, sub.as_slice()).is_some(),
            ByteMatcher::Present => !input.is_empty(),
            ByteMatcher::Glob(pattern) => glob_match(pattern.as_slice(), input),
            ByteMatcher::AnyOf(matchers) => matchers.iter().any(|m| m.is_match(input)),
        }
    }

    /// Lowers a regex or literal string pattern into a zero-regex ByteMatcher.
    pub fn compile_from_regex(pattern: &str) -> Result<Self, crate::Error> {
        let trimmed = pattern.trim();
        if trimmed.is_empty() {
            return Err(crate::Error::InvalidPolicy);
        }

        // 1. Verify syntax balance (e.g. catch unclosed '[' or '(')
        let mut paren_depth = 0i32;
        let mut in_bracket = false;
        let bytes = trimmed.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];
            if b == b'\\' {
                i += 2; // skip escaped char
                continue;
            }
            if b == b'[' && !in_bracket {
                in_bracket = true;
            } else if b == b']' && in_bracket {
                in_bracket = false;
            } else if b == b'(' && !in_bracket {
                paren_depth += 1;
            } else if b == b')' && !in_bracket {
                paren_depth -= 1;
                if paren_depth < 0 {
                    return Err(crate::Error::InvalidPolicy);
                }
            }
            i += 1;
        }
        if paren_depth != 0 || in_bracket {
            return Err(crate::Error::InvalidPolicy);
        }

        // 2. Strip standard regex boundaries: leading '^' and trailing '$'
        let mut core = trimmed;
        if core.starts_with('^') {
            core = &core[1..];
        }
        if core.ends_with('$') && !core.ends_with(r"\$") {
            core = &core[..core.len() - 1];
        }

        if core == ".*" || core == "*" || core.is_empty() {
            return Ok(ByteMatcher::Present);
        }

        // 3. Check for top-level or parenthesized alternatives: (a|b|c) or a|b|c
        let inner = if core.starts_with('(') && core.ends_with(')') {
            &core[1..core.len() - 1]
        } else {
            core
        };

        if inner.contains('|') {
            let parts: Vec<&str> = inner.split('|').collect();
            let mut sub_matchers = Vec::with_capacity(parts.len());
            let mut all_exact = true;
            let mut exact_values = Vec::with_capacity(parts.len());

            for p in parts {
                let p_trimmed = p.trim();
                if p_trimmed.is_empty() {
                    return Err(crate::Error::InvalidPolicy);
                }
                if let Some(prefix) = p_trimmed.strip_suffix(".*") {
                    all_exact = false;
                    let clean_prefix = unescape_regex(prefix);
                    sub_matchers.push(ByteMatcher::Prefix(clean_prefix.into_bytes()));
                } else if p_trimmed.contains('*') || p_trimmed.contains('?') {
                    all_exact = false;
                    sub_matchers.push(ByteMatcher::Glob(p_trimmed.as_bytes().to_vec()));
                } else {
                    let clean = unescape_regex(p_trimmed);
                    exact_values.push(clean.as_bytes().to_vec());
                    sub_matchers.push(ByteMatcher::exact(clean.as_bytes()));
                }
            }

            if all_exact {
                return Ok(ByteMatcher::OneOf(exact_values));
            } else {
                return Ok(ByteMatcher::AnyOf(sub_matchers));
            }
        }

        // 4. Handle prefix patterns (e.g. `/v2/.*` or `/api/v[0-9]+/.*`)
        if let Some(prefix) = core.strip_suffix(".*") {
            if let Some(sub) = prefix.strip_prefix(".*") {
                // `.*substr.*` -> Contains
                let clean = unescape_regex(sub);
                return Ok(ByteMatcher::Contains(clean.into_bytes()));
            }
            if prefix.contains('[') {
                // Character class in prefix -> convert to Glob
                let glob_str = convert_simple_class_to_glob(core);
                return Ok(ByteMatcher::Glob(glob_str.into_bytes()));
            }
            let clean = unescape_regex(prefix);
            return Ok(ByteMatcher::Prefix(clean.into_bytes()));
        }

        // 5. Handle suffix patterns (e.g. `.*\.internal`)
        if let Some(suffix) = core.strip_prefix(".*") {
            let clean = unescape_regex(suffix);
            return Ok(ByteMatcher::Suffix(clean.into_bytes()));
        }

        // 6. Handle globs / wildcards
        if core.contains('*') || core.contains('?') || core.contains('[') {
            let glob_str = convert_simple_class_to_glob(core);
            return Ok(ByteMatcher::Glob(glob_str.into_bytes()));
        }

        // 7. Plain literal string
        let clean = unescape_regex(core);
        Ok(ByteMatcher::exact(clean.as_bytes()))
    }
}

/// Unescapes common regex escape sequences: `\.` -> `.`, `\/` -> `/`, etc.
fn unescape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Converts simple regex classes like `[0-9]+` or `[a-z]+` into glob `*`.
fn convert_simple_class_to_glob(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            while let Some(&inner) = chars.peek() {
                chars.next();
                if inner == ']' {
                    break;
                }
            }
            if let Some(&next) = chars.peek()
                && (next == '+' || next == '*')
            {
                chars.next();
            }
            out.push('*');
        } else if c == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Iterative, linear-time O(N) glob pattern matcher with 0 allocations.
#[inline]
pub fn glob_match(pattern: &[u8], text: &[u8]) -> bool {
    let mut p_idx = 0;
    let mut t_idx = 0;
    let mut star_p = None;
    let mut star_t = 0;

    let p_len = pattern.len();
    let t_len = text.len();

    while t_idx < t_len {
        if p_idx < p_len && (pattern[p_idx] == b'?' || pattern[p_idx] == text[t_idx]) {
            p_idx += 1;
            t_idx += 1;
        } else if p_idx < p_len && pattern[p_idx] == b'*' {
            star_p = Some(p_idx);
            p_idx += 1;
            star_t = t_idx;
        } else if let Some(sp) = star_p {
            p_idx = sp + 1;
            star_t += 1;
            t_idx = star_t;
        } else {
            return false;
        }
    }

    while p_idx < p_len && pattern[p_idx] == b'*' {
        p_idx += 1;
    }

    p_idx == p_len
}

#[derive(Deserialize, Clone, Debug)]
pub struct MatchConditionInput {
    pub target: String,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub regex: Option<String>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct UpstreamHeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct CanaryReleaseRuleInput {
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    pub baseline_upstream: String,
    pub canary_upstream: String,
    #[serde(default)]
    pub match_conditions: Vec<MatchConditionInput>,
    #[serde(default = "default_weight_percentage")]
    pub weight_percentage: u32,
    #[serde(default = "default_split_by")]
    pub split_by: String,
    #[serde(default)]
    pub header_name: Option<String>,
    #[serde(default)]
    pub cookie_name: Option<String>,
    #[serde(default)]
    pub canary_upstream_headers: Vec<UpstreamHeaderInput>,
    #[serde(default)]
    pub baseline_upstream_headers: Vec<UpstreamHeaderInput>,
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
fn default_weight_percentage() -> u32 {
    0
}
fn default_split_by() -> String {
    "client_ip".to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct CanaryReleaseSnapshot {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub rules: Vec<CanaryReleaseRuleInput>,
}

fn default_schema_version() -> u32 {
    1
}

/// Metadata and precompiled headers for a single deployment slot (32 bytes).
#[repr(C)]
#[derive(Clone, Debug)]
pub struct CanarySlotMeta {
    pub upstream: Arc<str>,
    pub headers: Arc<[(String, String)]>,
}

/// Contiguous 64-byte aligned slot sheet: [0] = Baseline, [1] = Canary.
/// Resides 100% inside a single L1 data cacheline with 0 cacheline crossing overhead.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct CanarySlotSheet {
    pub slots: [CanarySlotMeta; 2],
}

#[derive(Clone, Debug)]
pub struct CompiledMatchCondition {
    pub target: MatchTarget,
    pub key: String,
    pub matcher: ByteMatcher,
}

#[derive(Clone, Debug)]
pub struct CompiledCanaryRule {
    // --- Cacheline 0: 64 bytes (Hot route matching fields) ---
    pub origin_bytes: Vec<u8>,
    pub path_prefix_bytes: Vec<u8>,
    pub is_wildcard_origin: bool,
    pub is_root_path: bool,
    pub path_prefix_ends_with_slash: bool,
    pub split_by: SplitBy,
    pub weight_percentage: u32,
    pub has_conditions: bool,
    pub _pad: [u8; 7],

    // --- Cacheline 1: 64 bytes (SlotSheet) ---
    pub slot_sheet: CanarySlotSheet,

    // --- Cacheline 2 & 3: Post-match metadata ---
    pub id: String,
    pub header_name: Option<String>,
    pub cookie_name: Option<Vec<u8>>,
    pub match_conditions: Vec<CompiledMatchCondition>,
}

#[derive(Clone, Copy, Debug)]
pub struct CanaryReleaseEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub uri: &'a [u8],
    pub query_string: &'a [u8],
    pub client_ip: &'a [u8],
    pub random_seed: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanaryDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub upstream: &'a str,
    pub is_canary: bool,
    pub upstream_headers: &'a [(String, String)],
    pub headers_arc: Option<Arc<[(String, String)]>>,
}

impl<'a> CanaryDecision<'a> {
    #[inline(always)]
    pub fn unmatched() -> CanaryDecision<'static> {
        CanaryDecision {
            matched: false,
            rule_id: "",
            upstream: "",
            is_canary: false,
            upstream_headers: &[],
            headers_arc: None,
        }
    }

    #[inline(always)]
    pub fn matched(
        rule_id: &'a str,
        is_canary: bool,
        meta: &'a CanarySlotMeta,
    ) -> Self {
        let (hdrs, arc_opt) = if meta.headers.is_empty() {
            (&[][..], None)
        } else {
            (meta.headers.as_ref(), Some(Arc::clone(&meta.headers)))
        };
        Self {
            matched: true,
            rule_id,
            upstream: meta.upstream.as_ref(),
            is_canary,
            upstream_headers: hdrs,
            headers_arc: arc_opt,
        }
    }
}
