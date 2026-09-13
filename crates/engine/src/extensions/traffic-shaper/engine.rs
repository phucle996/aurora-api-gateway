use super::types::{
    CompiledRule, LimitBy, MAX_TRAFFIC_SHAPER_POLICY_BYTES, MAX_TRAFFIC_SHAPER_RULES,
    TrafficShaperDecision, TrafficShaperSnapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

pub struct TrafficShaperEngine {
    generation: u64,
    rules: Vec<CompiledRule>,
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

impl TrafficShaperEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_TRAFFIC_SHAPER_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: TrafficShaperSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > MAX_TRAFFIC_SHAPER_RULES {
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
            .sort_by_key(|r| (r.priority, host_specificity(&r.host), r.id.clone()));

        let mut rules = Vec::with_capacity(snapshot.rules.len());
        for rule in snapshot.rules {
            let host_valid = if rule.host == "*" {
                true
            } else if let Some(sub) = rule.host.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                rule.host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };

            if rule.rate_kb_per_sec == 0
                || rule.rate_kb_per_sec > 10_000_000
                || rule.burst_kb > 10_000_000
                || !host_valid
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
            {
                return Err(Error::InvalidPolicy);
            }

            let (limit_by, header_name) = match rule.limit_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => (LimitBy::ClientIp, None),
                "route_path" => (LimitBy::RoutePath, None),
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
                    (LimitBy::Header, Some(h_name))
                }
                _ => return Err(Error::InvalidPolicy),
            };

            rules.push(CompiledRule {
                id: rule.id,
                host: rule.host,
                path_prefix: rule.path_prefix,
                limit_by,
                header_name,
                rate_bytes_per_sec: rule.rate_kb_per_sec.saturating_mul(1024),
                burst_bytes: rule.burst_kb.saturating_mul(1024),
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    pub fn evaluate<'a, 'h>(
        &'a self,
        host: &[u8],
        path: &[u8],
        client_ip: &[u8],
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> TrafficShaperDecision<'a> {
        if host.is_empty()
            || host.len() > 253
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || !path.starts_with(b"/")
            || client_ip.is_empty()
            || client_ip.len() > 64
        {
            return TrafficShaperDecision::passthrough();
        }

        for rule in &self.rules {
            if !host_matches(rule.host.as_bytes(), host) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), path) {
                continue;
            }

            match rule.limit_by {
                LimitBy::ClientIp => {
                    return TrafficShaperDecision {
                        rate_bytes_per_sec: rule.rate_bytes_per_sec,
                        burst_bytes: rule.burst_bytes,
                        matched: true,
                        rule_id: rule.id.as_str(),
                    };
                }
                LimitBy::RoutePath => {
                    return TrafficShaperDecision {
                        rate_bytes_per_sec: rule.rate_bytes_per_sec,
                        burst_bytes: rule.burst_bytes,
                        matched: true,
                        rule_id: rule.id.as_str(),
                    };
                }
                LimitBy::Header => {
                    if let Some(ref h_name) = rule.header_name
                        && let Some(val) = header_lookup(h_name)
                        && !val.is_empty()
                    {
                        return TrafficShaperDecision {
                            rate_bytes_per_sec: rule.rate_bytes_per_sec,
                            burst_bytes: rule.burst_bytes,
                            matched: true,
                            rule_id: rule.id.as_str(),
                        };
                    }
                    // If header absent or empty, skip to next rule in priority order
                    continue;
                }
            }
        }

        TrafficShaperDecision::passthrough()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }
}
