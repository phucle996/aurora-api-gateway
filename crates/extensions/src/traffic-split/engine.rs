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

#[inline(always)]
fn fnv1a_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut i = 0;
    while i + 4 <= data.len() {
        hash = (hash ^ data[i] as u64).wrapping_mul(0x100000001b3);
        hash = (hash ^ data[i + 1] as u64).wrapping_mul(0x100000001b3);
        hash = (hash ^ data[i + 2] as u64).wrapping_mul(0x100000001b3);
        hash = (hash ^ data[i + 3] as u64).wrapping_mul(0x100000001b3);
        i += 4;
    }
    while i < data.len() {
        hash = (hash ^ data[i] as u64).wrapping_mul(0x100000001b3);
        i += 1;
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

            let is_wildcard_origin = rule.origin == "*";
            let origin_bytes = rule.origin.as_bytes().to_vec();
            let path_prefix_bytes = rule.path_prefix.as_bytes().to_vec();
            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');

            rules.push(CompiledRule {
                id: rule.id,
                is_wildcard_origin,
                origin_bytes,
                path_prefix_bytes,
                path_prefix_ends_with_slash,
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

    #[inline]
    pub fn evaluate_ctx<'a, 'h>(
        &'a self,
        ctx: &crate::AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> TrafficSplitDecision<'a> {
        let req = TrafficSplitEvalRequest {
            origin: ctx.host,
            path: ctx.path,
            client_ip: ctx.client_ip,
            random_seed: ctx.random_seed,
        };
        self.evaluate(&req, header_lookup)
    }

    pub fn evaluate<'a, 'h>(
        &'a self,
        req: &TrafficSplitEvalRequest<'_>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> TrafficSplitDecision<'a> {
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
            if !rule.is_wildcard_origin && !host_matches(&rule.origin_bytes, req.origin) {
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

            // Fast branchless path for common 2-target split (e.g. 80/20, 90/10)
            if rule.targets.len() == 2 {
                let target = if bucket < rule.targets[0].cumulative_weight {
                    &rule.targets[0]
                } else {
                    &rule.targets[1]
                };
                return TrafficSplitDecision::matched(rule.id.as_str(), target.upstream.as_str());
            }

            for target in &rule.targets {
                if bucket < target.cumulative_weight {
                    return TrafficSplitDecision::matched(
                        rule.id.as_str(),
                        target.upstream.as_str(),
                    );
                }
            }

            // Fallback safety to last target
            if let Some(last) = rule.targets.last() {
                return TrafficSplitDecision::matched(rule.id.as_str(), last.upstream.as_str());
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
