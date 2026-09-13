use super::types::{
    MAX_REQUEST_MIRROR_POLICY_BYTES, MAX_REQUEST_MIRROR_RULES, MirrorDecision,
    RequestMirrorRuleInput, RequestMirrorSnapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug, Clone)]
pub struct CompiledMirrorRule {
    pub id: String,
    pub priority: u32,
    pub origin: String,
    pub path_prefix: String,
    pub methods: Vec<String>,
    pub primary_upstream: String,
    pub mirror_upstream: String,
    pub sample_percentage: u32,
    pub ignore_mirror_errors: bool,
    pub mirror_headers: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct RequestMirrorEngine {
    generation: u64,
    rules: Vec<CompiledMirrorRule>,
}

#[derive(Clone, Copy, Debug)]
pub struct RequestMirrorEvalRequest<'a> {
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub random_seed: u32,
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

impl RequestMirrorEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_REQUEST_MIRROR_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: RequestMirrorSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if let Some(schema) = snapshot.schema_version
            && schema != 1
        {
            return Err(Error::InvalidPolicy);
        }

        let mut input_rules = snapshot.rules.unwrap_or_default();

        // Support flat configuration
        if input_rules.is_empty() {
            if let (Some(primary), Some(mirror)) = (
                snapshot.primary_upstream.take(),
                snapshot.mirror_upstream.take(),
            ) {
                input_rules.push(RequestMirrorRuleInput {
                    id: "default".to_string(),
                    priority: 100,
                    origin: "*".to_string(),
                    path_prefix: "/".to_string(),
                    methods: Vec::new(),
                    primary_upstream: primary,
                    mirror_upstream: mirror,
                    sample_percentage: snapshot.sample_percentage.unwrap_or(100),
                    ignore_mirror_errors: snapshot.ignore_mirror_errors.unwrap_or(true),
                    mirror_headers: Vec::new(),
                });
            } else {
                return Err(Error::InvalidPolicy);
            }
        }

        if input_rules.len() > MAX_REQUEST_MIRROR_RULES {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = std::collections::HashSet::with_capacity(input_rules.len());
        for rule in &input_rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
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
                || rule.primary_upstream.trim().is_empty()
                || rule.primary_upstream.len() > 128
                || rule.mirror_upstream.trim().is_empty()
                || rule.mirror_upstream.len() > 128
                || rule.primary_upstream == rule.mirror_upstream
                || rule.sample_percentage > 100
            {
                return Err(Error::InvalidPolicy);
            }

            let methods: Vec<String> = rule
                .methods
                .into_iter()
                .map(|m| m.trim().to_ascii_uppercase())
                .filter(|m| !m.is_empty())
                .collect();

            let mut mirror_headers: Vec<(String, String)> = rule
                .mirror_headers
                .into_iter()
                .filter(|h| !h.name.trim().is_empty() && h.name.len() <= 64 && h.value.len() <= 256)
                .map(|h| (h.name, h.value))
                .collect();

            // Default signal header: ensure secondary upstream knows this is a mirror/shadow request
            if !mirror_headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("x-request-mirror"))
            {
                mirror_headers.push(("x-request-mirror".to_string(), "true".to_string()));
            }

            rules.push(CompiledMirrorRule {
                id: rule.id,
                priority: rule.priority,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                methods,
                primary_upstream: rule.primary_upstream,
                mirror_upstream: rule.mirror_upstream,
                sample_percentage: rule.sample_percentage,
                ignore_mirror_errors: rule.ignore_mirror_errors,
                mirror_headers,
            });
        }

        Ok(RequestMirrorEngine {
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

    pub fn evaluate<'a, 'h>(&'a self, req: &RequestMirrorEvalRequest<'h>) -> MirrorDecision<'a> {
        for rule in &self.rules {
            if !host_matches(rule.origin.as_bytes(), req.host) {
                continue;
            }

            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

            if !rule.methods.is_empty() {
                let method_matched = rule
                    .methods
                    .iter()
                    .any(|m| m.as_bytes().eq_ignore_ascii_case(req.method));
                if !method_matched {
                    continue;
                }
            }

            // Route matched! Determine sampling.
            let is_mirrored = if rule.sample_percentage >= 100 {
                true
            } else if rule.sample_percentage == 0 {
                false
            } else {
                (req.random_seed % 100) < rule.sample_percentage
            };

            return MirrorDecision::matched(
                rule.id.as_str(),
                rule.primary_upstream.as_str(),
                rule.mirror_upstream.as_str(),
                is_mirrored,
                &rule.mirror_headers,
            );
        }

        MirrorDecision::unmatched()
    }
}
