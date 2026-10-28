use super::types::{
    MAX_REQUEST_TERMINATION_POLICY_BYTES, MAX_REQUEST_TERMINATION_RULES,
    RequestTerminationRuleInput, RequestTerminationSnapshot, TerminationDecision,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

const METHOD_GET: u16 = 1 << 0;
const METHOD_HEAD: u16 = 1 << 1;
const METHOD_POST: u16 = 1 << 2;
const METHOD_PUT: u16 = 1 << 3;
const METHOD_DELETE: u16 = 1 << 4;
const METHOD_CONNECT: u16 = 1 << 5;
const METHOD_OPTIONS: u16 = 1 << 6;
const METHOD_TRACE: u16 = 1 << 7;
const METHOD_PATCH: u16 = 1 << 8;
const METHOD_OTHER: u16 = 1 << 15;
const METHOD_ALL: u16 = 0xFFFF;

#[inline(always)]
fn method_to_mask(method: &[u8]) -> u16 {
    if method.eq_ignore_ascii_case(b"GET") {
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
        METHOD_OTHER
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
    pub path_prefix_bytes: Vec<u8>,
    pub path_prefix_ends_with_slash: bool,
    pub methods: Vec<String>,
    pub method_mask: u16,
    pub status_code: u16,
    pub content_type: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
    pub bypass_headers: Vec<(String, String)>,
    pub bypass_headers_bytes: Vec<(Vec<u8>, Vec<u8>)>,
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

        if let Some(schema) = snapshot.schema_version
            && schema != 1
        {
            return Err(Error::InvalidPolicy);
        }

        let mut input_rules = snapshot.rules.unwrap_or_default();

        // Support flat configuration
        if input_rules.is_empty()
            && let Some(sc) = snapshot.status_code
        {
            input_rules.push(RequestTerminationRuleInput {
                id: "default".to_string(),
                priority: 10,
                origin: "*".to_string(),
                path_prefix: "/".to_string(),
                methods: Vec::new(),
                status_code: sc,
                content_type: snapshot
                    .content_type
                    .unwrap_or_else(|| "application/json; charset=utf-8".to_string()),
                body: snapshot.body.unwrap_or_else(|| {
                    r#"{"error":"Service temporarily unavailable"}"#.to_string()
                }),
                headers: snapshot.headers.unwrap_or_default(),
                bypass_headers: snapshot.bypass_headers.unwrap_or_default(),
            });
        }

        if input_rules.len() > MAX_REQUEST_TERMINATION_RULES {
            return Err(Error::InvalidPolicy);
        }

        input_rules.sort_by_key(|r| (r.priority, host_specificity(&r.origin), r.id.clone()));

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
            {
                return Err(Error::InvalidPolicy);
            }

            let methods: Vec<String> = rule
                .methods
                .into_iter()
                .map(|m| m.trim().to_ascii_uppercase())
                .filter(|m| !m.is_empty())
                .collect();

            let headers: Vec<(String, String)> = rule
                .headers
                .into_iter()
                .filter(|h| !h.name.trim().is_empty() && h.name.len() <= 64 && h.value.len() <= 256)
                .map(|h| (h.name, h.value))
                .collect();

            let bypass_headers: Vec<(String, String)> = rule
                .bypass_headers
                .into_iter()
                .filter(|h| !h.name.trim().is_empty() && h.name.len() <= 64 && h.value.len() <= 256)
                .map(|h| (h.name, h.value))
                .collect();

            let method_mask = if methods.is_empty() {
                METHOD_ALL
            } else {
                methods
                    .iter()
                    .fold(0u16, |mask, m| mask | method_to_mask(m.as_bytes()))
            };

            let bypass_headers_bytes: Vec<(Vec<u8>, Vec<u8>)> = bypass_headers
                .iter()
                .map(|(k, v)| (k.as_bytes().to_vec(), v.as_bytes().to_vec()))
                .collect();

            let is_wildcard_origin = rule.origin == "*";
            let origin_bytes = rule.origin.as_bytes().to_vec();
            let path_prefix_bytes = rule.path_prefix.as_bytes().to_vec();
            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');

            rules.push(CompiledTerminationRule {
                id: rule.id,
                priority: rule.priority,
                origin: rule.origin,
                is_wildcard_origin,
                origin_bytes,
                path_prefix: rule.path_prefix,
                path_prefix_bytes,
                path_prefix_ends_with_slash,
                methods,
                method_mask,
                status_code: rule.status_code,
                content_type: rule.content_type,
                body: rule.body,
                headers,
                bypass_headers,
                bypass_headers_bytes,
            });
        }

        Ok(RequestTerminationEngine {
            generation: snapshot.generation.unwrap_or(1),
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

    #[inline]
    pub fn evaluate_ctx<'a>(
        &'a self,
        ctx: &crate::AccessRequestContext<'a>,
    ) -> TerminationDecision<'a> {
        let req = RequestTerminationEvalRequest {
            host: ctx.host,
            path: ctx.path,
            method: ctx.method,
            headers: &[],
        };
        self.evaluate(&req)
    }

    #[inline]
    pub fn evaluate<'a>(
        &'a self,
        req: &RequestTerminationEvalRequest<'a>,
    ) -> TerminationDecision<'a> {
        let req_method_mask = method_to_mask(req.method);

        for rule in &self.rules {
            if !rule.is_wildcard_origin && !host_matches(&rule.origin_bytes, req.host) {
                continue;
            }

            if !req.path.starts_with(&rule.path_prefix_bytes) {
                continue;
            }

            if !rule.path_prefix_ends_with_slash
                && req.path.len() > rule.path_prefix_bytes.len()
                && req.path[rule.path_prefix_bytes.len()] != b'/'
            {
                continue;
            }

            // Single bitwise check instead of linear method string iteration
            if (rule.method_mask & req_method_mask) == 0 {
                continue;
            }

            // Route matched! Check for bypass headers
            let bypassed = !rule.bypass_headers_bytes.is_empty()
                && rule.bypass_headers_bytes.iter().any(|(bk, bv)| {
                    req.headers
                        .iter()
                        .any(|&(hk, hv)| hk.eq_ignore_ascii_case(bk) && hv == bv.as_slice())
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
}
