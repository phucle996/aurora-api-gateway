use super::types::{
    MAX_REQUEST_TERMINATION_POLICY_BYTES, MAX_REQUEST_TERMINATION_RULES,
    RequestTerminationRuleInput, RequestTerminationSnapshot, TerminationDecision,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug, Clone)]
pub struct CompiledTerminationRule {
    pub id: String,
    pub priority: u32,
    pub origin: String,
    pub path_prefix: String,
    pub methods: Vec<String>,
    pub status_code: u16,
    pub content_type: String,
    pub body: String,
    pub headers: Vec<(String, String)>,
    pub bypass_headers: Vec<(String, String)>,
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

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
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
        if input_rules.is_empty() {
            if let Some(sc) = snapshot.status_code {
                input_rules.push(RequestTerminationRuleInput {
                    id: "default".to_string(),
                    priority: 10,
                    origin: "*".to_string(),
                    path_prefix: "/".to_string(),
                    methods: Vec::new(),
                    status_code: sc,
                    content_type: snapshot.content_type.unwrap_or_else(|| "application/json; charset=utf-8".to_string()),
                    body: snapshot.body.unwrap_or_else(|| r#"{"error":"Service temporarily unavailable"}"#.to_string()),
                    headers: snapshot.headers.unwrap_or_default(),
                    bypass_headers: snapshot.bypass_headers.unwrap_or_default(),
                });
            }
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

            rules.push(CompiledTerminationRule {
                id: rule.id,
                priority: rule.priority,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                methods,
                status_code: rule.status_code,
                content_type: rule.content_type,
                body: rule.body,
                headers,
                bypass_headers,
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
    pub fn evaluate<'a>(
        &'a self,
        req: &RequestTerminationEvalRequest<'a>,
    ) -> TerminationDecision<'a> {
        for rule in &self.rules {
            if !host_matches(rule.origin.as_bytes(), req.host) {
                continue;
            }

            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

            if !rule.methods.is_empty()
                && !rule
                    .methods
                    .iter()
                    .any(|m| m.as_bytes().eq_ignore_ascii_case(req.method))
            {
                continue;
            }

            // Route matched! Check for bypass headers
            let bypassed = !rule.bypass_headers.is_empty()
                && rule.bypass_headers.iter().any(|(bk, bv)| {
                    req.headers.iter().any(|&(hk, hv)| {
                        hk.eq_ignore_ascii_case(bk.as_bytes()) && hv == bv.as_bytes()
                    })
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
