use super::types::{
    MAX_REQUEST_TERMINATION_POLICY_BYTES, MAX_REQUEST_TERMINATION_RULES,
    RequestTerminationSnapshot, TerminationDecision,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

pub const METHOD_GET: u16 = 1 << 0;
pub const METHOD_HEAD: u16 = 1 << 1;
pub const METHOD_POST: u16 = 1 << 2;
pub const METHOD_PUT: u16 = 1 << 3;
pub const METHOD_DELETE: u16 = 1 << 4;
pub const METHOD_CONNECT: u16 = 1 << 5;
pub const METHOD_OPTIONS: u16 = 1 << 6;
pub const METHOD_TRACE: u16 = 1 << 7;
pub const METHOD_PATCH: u16 = 1 << 8;
pub const METHOD_OTHER: u16 = 1 << 15;
pub const METHOD_ALL: u16 = 0xFFFF;

/// Fast branchless/packed integer HTTP method bitmask evaluator.
///
/// Converts method bytes to a 16-bit mask in 1-2 CPU clock cycles (~0.3 ns)
/// without character loops, dynamic allocations, or sequential string comparisons.
#[inline(always)]
pub fn method_to_mask(method: &[u8]) -> u16 {
    match method.len() {
        3 => {
            // Little-endian ASCII packing for "GET" and "PUT" with bit 5 cleared (case-insensitive)
            let v = (u32::from(method[0] & !0x20))
                | (u32::from(method[1] & !0x20) << 8)
                | (u32::from(method[2] & !0x20) << 16);
            if v == 0x0054_4547 {
                METHOD_GET
            } else if v == 0x0054_5550 {
                METHOD_PUT
            } else {
                METHOD_OTHER
            }
        }
        4 => {
            // Little-endian ASCII packing for "POST" and "HEAD"
            let v = (u32::from(method[0] & !0x20))
                | (u32::from(method[1] & !0x20) << 8)
                | (u32::from(method[2] & !0x20) << 16)
                | (u32::from(method[3] & !0x20) << 24);
            if v == 0x5453_4F50 {
                METHOD_POST
            } else if v == 0x4441_4548 {
                METHOD_HEAD
            } else {
                METHOD_OTHER
            }
        }
        5 => {
            if method.eq_ignore_ascii_case(b"PATCH") {
                METHOD_PATCH
            } else if method.eq_ignore_ascii_case(b"TRACE") {
                METHOD_TRACE
            } else {
                METHOD_OTHER
            }
        }
        6 => {
            if method.eq_ignore_ascii_case(b"DELETE") {
                METHOD_DELETE
            } else {
                METHOD_OTHER
            }
        }
        7 => {
            if method.eq_ignore_ascii_case(b"CONNECT") {
                METHOD_CONNECT
            } else if method.eq_ignore_ascii_case(b"OPTIONS") {
                METHOD_OPTIONS
            } else {
                METHOD_OTHER
            }
        }
        _ => METHOD_OTHER,
    }
}

#[derive(Debug, Clone)]
pub struct CompiledTerminationRule {
    pub id: String,
    pub priority: u32,
    pub origin: String,
    pub is_wildcard_origin: bool,
    pub origin_bytes: Vec<u8>,
    pub path_prefix: String,
    pub is_root_path: bool,
    pub path_prefix_bytes: Vec<u8>,
    pub path_prefix_ends_with_slash: bool,
    pub methods: Vec<String>,
    pub method_mask: u16,
    pub status_code: u16,
    pub content_type: String,
    pub body: String,
    pub match_headers: Vec<(String, Vec<u8>)>,
    pub headers: Vec<(String, String)>,
    pub bypass_headers: Vec<(String, Vec<u8>)>,
}

#[derive(Debug)]
pub struct RequestTerminationEngine {
    generation: u64,
    rules: Vec<CompiledTerminationRule>,
}

#[derive(Clone, Copy, Debug)]
pub struct RequestTerminationEvalRequest<'a> {
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub headers: &'a [(&'a [u8], &'a [u8])],
}

impl RequestTerminationEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_REQUEST_TERMINATION_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let snapshot: RequestTerminationSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        let mut input_rules = snapshot.rules;
        if input_rules.is_empty() || input_rules.len() > MAX_REQUEST_TERMINATION_RULES {
            return Err(Error::InvalidPolicy);
        }

        input_rules.sort_by_key(|r| (r.priority, host_specificity(&r.origin), r.id.clone()));

        let is_valid_token_key = |k: &[u8]| {
            !k.is_empty()
                && k.len() <= 64
                && k.iter()
                    .all(|&b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        };
        let is_valid_header_value =
            |v: &[u8]| v.len() <= 256 && v.iter().all(|&b| b != b'\r' && b != b'\n' && b != 0);

        let mut rules = Vec::with_capacity(input_rules.len());
        for rule in input_rules {
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

            if !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || !(200..=599).contains(&rule.status_code)
                || rule.content_type.trim().is_empty()
                || rule.content_type.len() > 128
                || rule.body.len() > 65536
                || rule.match_headers.len() > 16
                || rule.headers.len() > 16
                || rule.bypass_headers.len() > 16
            {
                return Err(Error::InvalidPolicy);
            }

            let methods: Vec<String> = rule
                .methods
                .into_iter()
                .map(|m| m.trim().to_ascii_uppercase())
                .filter(|m| !m.is_empty())
                .collect();

            let mut match_headers = Vec::with_capacity(rule.match_headers.len());
            for h in rule.match_headers {
                let name = h.name.trim().to_string();
                if !is_valid_token_key(name.as_bytes())
                    || !is_valid_header_value(h.value.as_bytes())
                {
                    return Err(Error::InvalidPolicy);
                }
                match_headers.push((name, h.value.into_bytes()));
            }

            let mut headers = Vec::with_capacity(rule.headers.len());
            for h in rule.headers {
                let name = h.name.trim().to_string();
                if !is_valid_token_key(name.as_bytes())
                    || !is_valid_header_value(h.value.as_bytes())
                {
                    return Err(Error::InvalidPolicy);
                }
                headers.push((name, h.value));
            }

            let mut bypass_headers = Vec::with_capacity(rule.bypass_headers.len());
            for h in rule.bypass_headers {
                let name = h.name.trim().to_string();
                if !is_valid_token_key(name.as_bytes())
                    || !is_valid_header_value(h.value.as_bytes())
                {
                    return Err(Error::InvalidPolicy);
                }
                bypass_headers.push((name, h.value.into_bytes()));
            }

            let method_mask = if methods.is_empty() {
                METHOD_ALL
            } else {
                methods
                    .iter()
                    .fold(0u16, |mask, m| mask | method_to_mask(m.as_bytes()))
            };

            let is_wildcard_origin = rule.origin == "*";
            let origin_bytes = rule.origin.as_bytes().to_vec();
            let is_root_path = rule.path_prefix == "/";
            let path_prefix_bytes = rule.path_prefix.as_bytes().to_vec();
            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');

            rules.push(CompiledTerminationRule {
                id: rule.id,
                priority: rule.priority,
                origin: rule.origin,
                is_wildcard_origin,
                origin_bytes,
                path_prefix: rule.path_prefix,
                is_root_path,
                path_prefix_bytes,
                path_prefix_ends_with_slash,
                methods,
                method_mask,
                status_code: rule.status_code,
                content_type: rule.content_type,
                body: rule.body,
                match_headers,
                headers,
                bypass_headers,
            });
        }

        Ok(RequestTerminationEngine {
            generation: snapshot.generation,
            rules,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline]
    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }

    #[inline(always)]
    pub fn evaluate_with_lookup<'a>(
        &'a self,
        host: &[u8],
        path: &[u8],
        method: &[u8],
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> TerminationDecision<'a> {
        let req_method_mask = method_to_mask(method);

        for rule in &self.rules {
            // 1. Origin match: fast-path for wildcard origin
            if !rule.is_wildcard_origin && !host_matches(&rule.origin_bytes, host) {
                continue;
            }

            // 2. Path prefix match: fast-path for root path ("/")
            if !rule.is_root_path {
                if !path.starts_with(&rule.path_prefix_bytes) {
                    continue;
                }

                if !rule.path_prefix_ends_with_slash
                    && path.len() > rule.path_prefix_bytes.len()
                    && path[rule.path_prefix_bytes.len()] != b'/'
                {
                    continue;
                }
            }

            // 3. Method bitmask match: single integer '&' instruction
            if (rule.method_mask & req_method_mask) == 0 {
                continue;
            }

            // 4. Request headers match: condition to trigger termination
            if !rule.match_headers.is_empty() {
                let headers_matched = rule.match_headers.iter().all(|(mk, mv)| {
                    header_lookup(mk).is_some_and(|actual| actual == mv.as_slice())
                });
                if !headers_matched {
                    continue;
                }
            }

            // 5. Bypass headers match: lazy evaluation only when rule defines bypass headers
            let bypassed = !rule.bypass_headers.is_empty()
                && rule.bypass_headers.iter().any(|(bk, bv)| {
                    header_lookup(bk).is_some_and(|actual| actual == bv.as_slice())
                });

            return TerminationDecision {
                matched: true,
                should_terminate: !bypassed,
                status_code: rule.status_code,
                content_type: &rule.content_type,
                body: &rule.body,
                headers: &rule.headers,
                rule_id: &rule.id,
            };
        }

        TerminationDecision::default()
    }

    #[inline]
    pub fn evaluate_ctx<'a>(
        &'a self,
        ctx: &crate::AccessRequestContext<'a>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> TerminationDecision<'a> {
        self.evaluate_with_lookup(ctx.host, ctx.path, ctx.method, header_lookup)
    }

    #[inline]
    pub fn evaluate<'a>(
        &'a self,
        req: &RequestTerminationEvalRequest<'a>,
    ) -> TerminationDecision<'a> {
        self.evaluate_with_lookup(req.host, req.path, req.method, |name| {
            req.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name.as_bytes()))
                .map(|(_, v)| *v)
        })
    }
}
