use super::types::{
    CanaryDecision, CanaryReleaseEvalRequest, CanaryReleaseSnapshot, CompiledCanaryRule,
    CompiledMatchCondition, MAX_CANARY_RELEASE_POLICY_BYTES, MAX_CANARY_RELEASE_RULES, MatchTarget,
    SplitBy,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug)]
pub struct CanaryReleaseEngine {
    generation: u64,
    rules: Vec<CompiledCanaryRule>,
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

fn fnv1a_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn find_query_param<'a>(query: &'a [u8], key: &[u8]) -> Option<&'a str> {
    for pair in query.split(|&b| b == b'&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, |&b| b == b'=');
        let k = parts.next()?;
        let v = parts.next().unwrap_or(b"");
        if k == key {
            return std::str::from_utf8(v).ok();
        }
    }
    None
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

        snapshot
            .rules
            .sort_by_key(|r| (r.priority, host_specificity(&r.origin), r.id.clone()));

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

            if !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || rule.baseline_upstream.trim().is_empty()
                || rule.baseline_upstream.len() > 128
                || rule.canary_upstream.trim().is_empty()
                || rule.canary_upstream.len() > 128
                || rule.baseline_upstream == rule.canary_upstream
                || rule.weight_percentage > 100
            {
                return Err(Error::InvalidPolicy);
            }

            let (split_by, header_name) = match rule.split_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => (SplitBy::ClientIp, None),
                "random" => (SplitBy::Random, None),
                "header" => {
                    let h_name = rule
                        .header_name
                        .as_ref()
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    if h_name.len() > 64
                        || !h_name
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    {
                        return Err(Error::InvalidPolicy);
                    }
                    (SplitBy::Header, Some(h_name))
                }
                _ => return Err(Error::InvalidPolicy),
            };

            let mut match_conditions = Vec::with_capacity(rule.match_conditions.len());
            for mc in rule.match_conditions {
                let target = match mc.target.trim().to_ascii_lowercase().as_str() {
                    "header" => MatchTarget::Header,
                    "uri" => MatchTarget::Uri,
                    "query" => MatchTarget::Query,
                    _ => return Err(Error::InvalidPolicy),
                };

                let key = if target == MatchTarget::Header {
                    let k = mc
                        .key
                        .filter(|s| !s.trim().is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    Some(k.trim().to_ascii_lowercase())
                } else {
                    mc.key
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                };

                let regex = regex::Regex::new(&mc.regex).map_err(|_| Error::InvalidPolicy)?;

                match_conditions.push(CompiledMatchCondition { target, key, regex });
            }

            let canary_upstream_headers = rule
                .canary_upstream_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();

            let baseline_upstream_headers = rule
                .baseline_upstream_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();

            rules.push(CompiledCanaryRule {
                id: rule.id,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                baseline_upstream: rule.baseline_upstream,
                canary_upstream: rule.canary_upstream,
                match_conditions,
                weight_percentage: rule.weight_percentage,
                split_by,
                header_name,
                canary_upstream_headers,
                baseline_upstream_headers,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    pub fn evaluate<'a>(
        &self,
        req: &CanaryReleaseEvalRequest<'a>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> CanaryDecision {
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

        for rule in &self.rules {
            if !host_matches(rule.origin.as_bytes(), req.origin) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

            // Layer 1: Check regex match conditions (Header, URI, Query)
            let mut regex_matched = false;
            for cond in &rule.match_conditions {
                let is_match = match cond.target {
                    MatchTarget::Header => {
                        if let Some(key) = cond.key.as_deref() {
                            if let Some(val_bytes) = header_lookup(key) {
                                if let Ok(val_str) = std::str::from_utf8(val_bytes) {
                                    cond.regex.is_match(val_str)
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    }
                    MatchTarget::Uri => {
                        let uri_str = std::str::from_utf8(req.uri).unwrap_or("");
                        let path_str = std::str::from_utf8(req.path).unwrap_or("");
                        cond.regex.is_match(uri_str) || cond.regex.is_match(path_str)
                    }
                    MatchTarget::Query => {
                        if let Some(key) = cond.key.as_deref() {
                            if let Some(val) = find_query_param(req.query_string, key.as_bytes()) {
                                cond.regex.is_match(val)
                            } else {
                                false
                            }
                        } else {
                            let q_str = std::str::from_utf8(req.query_string).unwrap_or("");
                            cond.regex.is_match(q_str)
                        }
                    }
                };

                if is_match {
                    regex_matched = true;
                    break;
                }
            }

            if regex_matched {
                return CanaryDecision::matched(
                    rule.id.clone(),
                    rule.canary_upstream.clone(),
                    true,
                    rule.canary_upstream_headers.clone(),
                );
            }

            // Layer 2: Percentage rollout for non-regex traffic
            if rule.weight_percentage > 0 {
                let bucket = match rule.split_by {
                    SplitBy::ClientIp => (fnv1a_hash(req.client_ip) % 100) as u32,
                    SplitBy::Random => req.random_seed % 100,
                    SplitBy::Header => {
                        let val = rule
                            .header_name
                            .as_deref()
                            .and_then(&header_lookup)
                            .filter(|v| !v.is_empty());
                        if let Some(val) = val {
                            (fnv1a_hash(val) % 100) as u32
                        } else {
                            (fnv1a_hash(req.client_ip) % 100) as u32
                        }
                    }
                };

                if bucket < rule.weight_percentage {
                    return CanaryDecision::matched(
                        rule.id.clone(),
                        rule.canary_upstream.clone(),
                        true,
                        rule.canary_upstream_headers.clone(),
                    );
                }
            }

            // Default: Baseline upstream
            return CanaryDecision::matched(
                rule.id.clone(),
                rule.baseline_upstream.clone(),
                false,
                rule.baseline_upstream_headers.clone(),
            );
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
