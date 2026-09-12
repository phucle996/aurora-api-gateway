use super::types::{
    CompiledRule, CompiledSplitTarget, MAX_TRAFFIC_SPLIT_POLICY_BYTES, MAX_TRAFFIC_SPLIT_RULES,
    SplitBy, TrafficSplitDecision, TrafficSplitEvalRequest, TrafficSplitSnapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug)]
pub struct TrafficSplitEngine {
    generation: u64,
    rules: Vec<CompiledRule>,
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

impl TrafficSplitEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_TRAFFIC_SPLIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: TrafficSplitSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > MAX_TRAFFIC_SPLIT_RULES {
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
                || rule.splits.len() < 2
                || rule.splits.len() > 16
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

            let mut total_weight: u32 = 0;
            let mut upstreams_seen = std::collections::HashSet::with_capacity(rule.splits.len());
            let mut targets = Vec::with_capacity(rule.splits.len());

            for s in rule.splits {
                if s.upstream.trim().is_empty()
                    || s.upstream.len() > 128
                    || s.weight == 0
                    || s.weight >= 100
                    || !upstreams_seen.insert(s.upstream.clone())
                {
                    return Err(Error::InvalidPolicy);
                }
                total_weight = total_weight.saturating_add(s.weight);
                targets.push(CompiledSplitTarget {
                    upstream: s.upstream,
                    cumulative_weight: total_weight,
                });
            }

            // Invariant: sum of weights must equal 100
            if total_weight != 100 {
                return Err(Error::InvalidPolicy);
            }

            rules.push(CompiledRule {
                id: rule.id,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                split_by,
                header_name,
                targets,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    pub fn evaluate<'a>(
        &self,
        req: &TrafficSplitEvalRequest<'a>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> TrafficSplitDecision {
        if req.origin.is_empty()
            || req.origin.len() > 253
            || req.path.is_empty()
            || req.path.len() > MAX_PATH_BYTES
            || !req.path.starts_with(b"/")
            || req.client_ip.is_empty()
            || req.client_ip.len() > 64
        {
            return TrafficSplitDecision::unmatched();
        }

        for rule in &self.rules {
            if !host_matches(rule.origin.as_bytes(), req.origin) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

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
                        // Fallback to client IP if header missing
                        (fnv1a_hash(req.client_ip) % 100) as u32
                    }
                }
            };

            for target in &rule.targets {
                if bucket < target.cumulative_weight {
                    return TrafficSplitDecision::matched(rule.id.clone(), target.upstream.clone());
                }
            }

            // Fallback safety to last target
            if let Some(last) = rule.targets.last() {
                return TrafficSplitDecision::matched(rule.id.clone(), last.upstream.clone());
            }
        }

        TrafficSplitDecision::unmatched()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }
}
