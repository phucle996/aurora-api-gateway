//! Dataplane High-Speed Canary Release Evaluation Engine
//!
//! Orchestrates Layer 1 byte pattern condition matching and Layer 2 sticky percentage rollout.
//! Uses 64-byte L1-aligned CanarySlotSheet for branchless selection and zero heap allocations.

use std::sync::Arc;
use super::policy::{
    ByteMatcher, CanaryDecision, CanaryReleaseEvalRequest, CanaryReleaseSnapshot, CanarySlotMeta,
    CanarySlotSheet, CompiledCanaryRule, CompiledMatchCondition, MatchTarget, SplitBy,
    UpstreamHeaderInput, MAX_CANARY_RELEASE_POLICY_BYTES, MAX_CANARY_RELEASE_RULES,
    MAX_CONDITIONS_PER_RULE, MAX_HEADERS_PER_SLOT,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug)]
pub struct CanaryReleaseEngine {
    generation: u64,
    rules: Vec<CompiledCanaryRule>,
}

#[inline(always)]
fn path_matches(prefix: &[u8], prefix_ends_with_slash: bool, path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix_ends_with_slash
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

#[inline(always)]
fn trim_ascii(b: &[u8]) -> &[u8] {
    let mut start = 0;
    while start < b.len()
        && (b[start] == b' ' || b[start] == b'\t' || b[start] == b'\r' || b[start] == b'\n')
    {
        start += 1;
    }
    let mut end = b.len();
    while end > start
        && (b[end - 1] == b' '
            || b[end - 1] == b'\t'
            || b[end - 1] == b'\r'
            || b[end - 1] == b'\n')
    {
        end -= 1;
    }
    &b[start..end]
}

#[inline]
pub fn extract_cookie<'a>(cookie_hdr: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    if cookie_hdr.is_empty() || key.is_empty() {
        return None;
    }
    // Fast SIMD pre-filter: skip parsing if key does not appear anywhere in the cookie header
    memchr::memmem::find(cookie_hdr, key)?;
    for pair in cookie_hdr.split(|&b| b == b';') {
        let trimmed = trim_ascii(pair);
        if trimmed.is_empty() {
            continue;
        }
        let (k, v) = match memchr::memchr(b'=', trimmed) {
            Some(pos) => (trim_ascii(&trimmed[..pos]), trim_ascii(&trimmed[pos + 1..])),
            None => (trimmed, &[][..]),
        };
        if k.eq_ignore_ascii_case(key) {
            return Some(v);
        }
    }
    None
}

#[inline]
pub fn extract_query_param<'a>(query: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    if query.is_empty() || key.is_empty() {
        return None;
    }
    // Fast SIMD pre-filter: skip parsing if key does not appear anywhere in the query string
    memchr::memmem::find(query, key)?;
    for pair in query.split(|&b| b == b'&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = match memchr::memchr(b'=', pair) {
            Some(pos) => (&pair[..pos], &pair[pos + 1..]),
            None => (pair, &[][..]),
        };
        if k == key {
            return Some(v);
        }
    }
    None
}

#[inline(always)]
pub fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let len = data.len();
    let mut i = 0;

    while i + 8 <= len {
        let chunk = u64::from_ne_bytes(data[i..i + 8].try_into().unwrap());
        hash = (hash ^ chunk).wrapping_mul(0x100000001b3);
        i += 8;
    }

    if i + 4 <= len {
        let chunk = u32::from_ne_bytes(data[i..i + 4].try_into().unwrap()) as u64;
        hash = (hash ^ chunk).wrapping_mul(0x100000001b3);
        i += 4;
    }

    while i < len {
        hash = (hash ^ data[i] as u64).wrapping_mul(0x100000001b3);
        i += 1;
    }

    hash
}

impl CanaryReleaseEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_CANARY_RELEASE_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: CanaryReleaseSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > MAX_CANARY_RELEASE_RULES {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = std::collections::HashSet::with_capacity(snapshot.rules.len());
        for rule in &snapshot.rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }

        // Longest-prefix matching: more specific paths take precedence over broader paths
        snapshot.rules.sort_by_key(|r| {
            (
                r.priority,
                host_specificity(&r.origin),
                std::cmp::Reverse(r.path_prefix.len()),
                r.id.clone(),
            )
        });

        let mut rules = Vec::with_capacity(snapshot.rules.len());
        for rule in snapshot.rules {
            let origin_valid = if rule.origin == "*" {
                true
            } else if let Some(sub) = rule.origin.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                rule.origin
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };

            let baseline_upstream = rule.baseline_upstream.trim().to_string();
            let canary_upstream = rule.canary_upstream.trim().to_string();

            let is_valid_upstream = |u: &str| {
                !u.is_empty()
                    && u.len() <= 128
                    && u.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
            };

            if !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || !is_valid_upstream(&baseline_upstream)
                || !is_valid_upstream(&canary_upstream)
                || baseline_upstream == canary_upstream
                || rule.weight_percentage > 100
                || rule.match_conditions.len() > MAX_CONDITIONS_PER_RULE
                || rule.canary_upstream_headers.len() > MAX_HEADERS_PER_SLOT
                || rule.baseline_upstream_headers.len() > MAX_HEADERS_PER_SLOT
            {
                return Err(Error::InvalidPolicy);
            }

            let is_valid_token_key = |k: &[u8]| {
                !k.is_empty()
                    && k.len() <= 64
                    && k.iter()
                        .all(|&b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            };

            let (split_by, header_name, cookie_name) = match rule.split_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => (SplitBy::ClientIp, None, None),
                "random" => (SplitBy::Random, None, None),
                "header" => {
                    let h_name = rule
                        .header_name
                        .as_ref()
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    if !is_valid_token_key(h_name.as_bytes()) {
                        return Err(Error::InvalidPolicy);
                    }
                    (SplitBy::Header, Some(h_name), None)
                }
                "cookie" => {
                    let c_name = rule
                        .cookie_name
                        .as_ref()
                        .map(|s| s.trim().to_ascii_lowercase().into_bytes())
                        .filter(|s| !s.is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    if !is_valid_token_key(&c_name) {
                        return Err(Error::InvalidPolicy);
                    }
                    (SplitBy::Cookie, None, Some(c_name))
                }
                _ => return Err(Error::InvalidPolicy),
            };

            let mut match_conditions = Vec::with_capacity(rule.match_conditions.len());
            for mc in rule.match_conditions {
                let target = match mc.target.trim().to_ascii_lowercase().as_str() {
                    "header" => MatchTarget::Header,
                    "cookie" => MatchTarget::Cookie,
                    "uri" => MatchTarget::Uri,
                    "path" => MatchTarget::Path,
                    "query" => MatchTarget::Query,
                    _ => return Err(Error::InvalidPolicy),
                };

                let key = if target == MatchTarget::Header || target == MatchTarget::Cookie {
                    let k = mc
                        .key
                        .filter(|s| !s.trim().is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    let trimmed_k = k.trim().to_ascii_lowercase();
                    if !is_valid_token_key(trimmed_k.as_bytes()) {
                        return Err(Error::InvalidPolicy);
                    }
                    trimmed_k
                } else if target == MatchTarget::Query {
                    mc.key
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                let matcher = if let Some(ref op) = mc.operator {
                    match op.trim().to_ascii_lowercase().as_str() {
                        "exact" => {
                            let val = mc.value.ok_or(Error::InvalidPolicy)?;
                            ByteMatcher::exact(val.as_bytes())
                        }
                        "one_of" => {
                            if mc.values.is_empty() {
                                return Err(Error::InvalidPolicy);
                            }
                            let vals = mc.values.into_iter().map(|s| s.into_bytes()).collect();
                            ByteMatcher::OneOf(vals)
                        }
                        "prefix" => {
                            let val = mc.value.ok_or(Error::InvalidPolicy)?;
                            ByteMatcher::Prefix(val.into_bytes())
                        }
                        "suffix" => {
                            let val = mc.value.ok_or(Error::InvalidPolicy)?;
                            ByteMatcher::Suffix(val.into_bytes())
                        }
                        "contains" => {
                            let val = mc.value.ok_or(Error::InvalidPolicy)?;
                            ByteMatcher::Contains(val.into_bytes())
                        }
                        "present" => ByteMatcher::Present,
                        _ => return Err(Error::InvalidPolicy),
                    }
                } else if let Some(ref regex_str) = mc.regex {
                    ByteMatcher::compile_from_regex(regex_str)?
                } else {
                    return Err(Error::InvalidPolicy);
                };

                match_conditions.push(CompiledMatchCondition { target, key, matcher });
            }

            let validate_headers = |hdrs: Vec<UpstreamHeaderInput>| -> Result<Arc<[(String, String)]>, Error> {
                let mut out = Vec::with_capacity(hdrs.len());
                for h in hdrs {
                    let name = h.name.trim().to_string();
                    let value = h.value.trim().to_string();
                    if !is_valid_token_key(name.as_bytes())
                        || value.len() > 256
                        || value.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0)
                    {
                        return Err(Error::InvalidPolicy);
                    }
                    out.push((name, value));
                }
                Ok(Arc::from(out))
            };

            let baseline_headers = validate_headers(rule.baseline_upstream_headers)?;
            let canary_headers = validate_headers(rule.canary_upstream_headers)?;

            let slot_sheet = CanarySlotSheet {
                slots: [
                    CanarySlotMeta {
                        upstream: baseline_upstream.into(),
                        headers: baseline_headers,
                    },
                    CanarySlotMeta {
                        upstream: canary_upstream.into(),
                        headers: canary_headers,
                    },
                ],
            };

            let is_root_path = rule.path_prefix == "/";
            let has_conditions = !match_conditions.is_empty();
            let is_wildcard_origin = rule.origin == "*";
            let origin_bytes = rule.origin.into_bytes();
            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');
            let path_prefix_bytes = rule.path_prefix.into_bytes();

            rules.push(CompiledCanaryRule {
                origin_bytes,
                path_prefix_bytes,
                is_wildcard_origin,
                is_root_path,
                path_prefix_ends_with_slash,
                split_by,
                weight_percentage: rule.weight_percentage,
                has_conditions,
                _pad: [0u8; 7],
                slot_sheet,
                id: rule.id,
                header_name,
                cookie_name,
                match_conditions,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    #[inline]
    pub fn evaluate_ctx<'a, 'h>(
        &'a self,
        ctx: &crate::AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> CanaryDecision<'a> {
        let req = CanaryReleaseEvalRequest {
            origin: ctx.host,
            path: ctx.path,
            uri: ctx.path,
            query_string: ctx.query,
            client_ip: ctx.client_ip,
            random_seed: ctx.random_seed,
        };
        self.evaluate(&req, header_lookup)
    }

    pub fn evaluate<'a, 'h>(
        &'a self,
        req: &CanaryReleaseEvalRequest<'_>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> CanaryDecision<'a> {
        if req.origin.is_empty()
            || req.origin.len() > 253
            || req.path.is_empty()
            || req.path.len() > MAX_PATH_BYTES
            || !req.path.starts_with(b"/")
            || req.client_ip.is_empty()
            || req.client_ip.len() > 64
        {
            return CanaryDecision::unmatched();
        }

        let mut cached_ip_hash: Option<u32> = None;

        for rule in &self.rules {
            if !rule.is_wildcard_origin && !host_matches(&rule.origin_bytes, req.origin) {
                continue;
            }
            if !rule.is_root_path
                && !path_matches(
                    &rule.path_prefix_bytes,
                    rule.path_prefix_ends_with_slash,
                    req.path,
                )
            {
                continue;
            }

            // Layer 1: Hardware-accelerated condition matching
            let mut condition_matched = false;
            if rule.has_conditions {
                for cond in &rule.match_conditions {
                    let is_match = match cond.target {
                        MatchTarget::Header => {
                            if let Some(val_bytes) = header_lookup(&cond.key) {
                                cond.matcher.is_match(val_bytes)
                            } else {
                                false
                            }
                        }
                        MatchTarget::Cookie => {
                            if let Some(cookie_hdr) = header_lookup("cookie") {
                                if let Some(val_bytes) = extract_cookie(cookie_hdr, cond.key.as_bytes()) {
                                    cond.matcher.is_match(val_bytes)
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        }
                        MatchTarget::Uri | MatchTarget::Path => cond.matcher.is_match(req.path),
                        MatchTarget::Query => {
                            if !cond.key.is_empty() {
                                if let Some(val) = extract_query_param(req.query_string, cond.key.as_bytes()) {
                                    cond.matcher.is_match(val)
                                } else {
                                    false
                                }
                            } else {
                                cond.matcher.is_match(req.query_string)
                            }
                        }
                    };

                    if is_match {
                        condition_matched = true;
                        break;
                    }
                }
            }

            // Layer 2: Percentage rollout for non-condition traffic (unified branchless resolution)
            let is_canary = if condition_matched {
                true
            } else if rule.weight_percentage > 0 {
                if rule.weight_percentage >= 100 {
                    true
                } else {
                    let bucket = match rule.split_by {
                        SplitBy::ClientIp => {
                            *cached_ip_hash.get_or_insert_with(|| fnv1a_64(req.client_ip) as u32 % 100)
                        }
                        SplitBy::Random => req.random_seed % 100,
                        SplitBy::Header => {
                            let val = rule
                                .header_name
                                .as_deref()
                                .and_then(&header_lookup)
                                .filter(|v| !v.is_empty());
                            if let Some(val) = val {
                                fnv1a_64(val) as u32 % 100
                            } else {
                                *cached_ip_hash.get_or_insert_with(|| fnv1a_64(req.client_ip) as u32 % 100)
                            }
                        }
                        SplitBy::Cookie => {
                            let val = rule.cookie_name.as_deref().and_then(|c_name| {
                                header_lookup("cookie").and_then(|c_hdr| extract_cookie(c_hdr, c_name))
                            });
                            if let Some(val) = val {
                                fnv1a_64(val) as u32 % 100
                            } else {
                                *cached_ip_hash.get_or_insert_with(|| fnv1a_64(req.client_ip) as u32 % 100)
                            }
                        }
                    };
                    bucket < rule.weight_percentage
                }
            } else {
                false
            };

            let meta = &rule.slot_sheet.slots[is_canary as usize];
            return CanaryDecision::matched(rule.id.as_str(), is_canary, meta);
        }

        CanaryDecision::unmatched()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }
}
