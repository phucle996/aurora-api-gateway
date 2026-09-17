use super::trie::IpRadixTree;
use super::types::{IpRestrictionRequest, IpRestrictionRule, IpRestrictionSnapshot};
use crate::{Decision, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES, host_matches, host_specificity};
use std::collections::HashSet;
use std::net::IpAddr;

#[derive(Clone, Debug)]
struct RuleBinding {
    rule_idx: usize,
    prefix_len: u8,
}

#[derive(Clone, Debug)]
pub struct CompiledRule {
    pub rule: IpRestrictionRule,
}

pub struct IpRestrictionEngine {
    generation: u64,
    tree: IpRadixTree<RuleBinding>,
    rules: Vec<CompiledRule>,
}

impl IpRestrictionEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snap: IpRestrictionSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snap.schema_version != 1
            || (snap.generation == 0 && !snap.rules.is_empty())
            || snap.generation > i64::MAX as u64
            || snap.rules.len() > 512
        {
            return Err(Error::InvalidPolicy);
        }

        snap.rules
            .sort_by_key(|r| (r.priority, host_specificity(&r.host), r.id));

        let mut ids = HashSet::new();
        let mut tree = IpRadixTree::new();
        let mut rules = Vec::with_capacity(snap.rules.len());

        for (rule_idx, rule) in snap.rules.into_iter().enumerate() {
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

            if rule.id == 0
                || !ids.insert(rule.id)
                || !matches!(rule.action.as_str(), "allow" | "block" | "log")
                || rule.networks.is_empty()
                || rule.networks.len() > 4096
                || rule.priority > 1_000_000
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !host_valid
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule
                    .path_prefix
                    .bytes()
                    .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
                || rule.path_prefix.contains("//")
                || rule.path_prefix.split('/').any(|s| s == "." || s == "..")
                || !matches!(
                    rule.method.as_str(),
                    "*" | "GET"
                        | "HEAD"
                        | "POST"
                        | "PUT"
                        | "PATCH"
                        | "DELETE"
                        | "OPTIONS"
                        | "CONNECT"
                        | "TRACE"
                )
            {
                return Err(Error::InvalidPolicy);
            }

            for cidr in &rule.networks {
                let (ip_str, bits_str) = cidr.split_once('/').ok_or(Error::InvalidPolicy)?;
                let ip: IpAddr = ip_str.parse().map_err(|_| Error::InvalidPolicy)?;
                let bits: u8 = bits_str.parse().map_err(|_| Error::InvalidPolicy)?;

                if (ip.is_ipv4() && bits > 32)
                    || (ip.is_ipv6() && bits > 128)
                    || matches!(ip, IpAddr::V6(v) if v.to_ipv4_mapped().is_some())
                {
                    return Err(Error::InvalidPolicy);
                }

                tree.insert(
                    ip,
                    bits,
                    RuleBinding {
                        rule_idx,
                        prefix_len: bits,
                    },
                );
            }

            rules.push(CompiledRule { rule });
        }

        Ok(Self {
            generation: snap.generation,
            tree,
            rules,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate(&self, q: IpRestrictionRequest<'_>) -> Result<Decision, Error> {
        let ip_str = std::str::from_utf8(q.ip).map_err(|_| Error::InvalidRequest)?;
        let ip: IpAddr = ip_str.parse().map_err(|_| Error::InvalidRequest)?;
        let ip = match ip {
            IpAddr::V6(v) => v.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
            _ => ip,
        };

        if q.path.is_empty()
            || q.path.len() > MAX_PATH_BYTES
            || q.path[0] != b'/'
            || q.host.len() > 253
            || q.method.len() > 16
        {
            return Err(Error::InvalidRequest);
        }

        let mut decision = Decision {
            generation: self.generation,
            ..Default::default()
        };

        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
        struct CandidateRank {
            priority: u32,
            rev_prefix_len: std::cmp::Reverse<u8>,
            id: u64,
        }

        let mut best_candidate: Option<(CandidateRank, usize)> = None;

        self.tree.for_each_match(ip, |binding| {
            let r = &self.rules[binding.rule_idx].rule;

            if !host_matches(r.host.as_bytes(), q.host) {
                return;
            }

            if r.method != "*" && r.method.as_bytes() != q.method {
                return;
            }

            if !q.path.starts_with(r.path_prefix.as_bytes()) {
                return;
            }

            if r.path_prefix != "/"
                && !r.path_prefix.ends_with('/')
                && q.path.len() > r.path_prefix.len()
                && q.path[r.path_prefix.len()] != b'/'
            {
                return;
            }

            let rank = CandidateRank {
                priority: r.priority,
                rev_prefix_len: std::cmp::Reverse(binding.prefix_len),
                id: r.id,
            };
            match &best_candidate {
                Some((best_rank, _)) if &rank >= best_rank => {}
                _ => {
                    best_candidate = Some((rank, binding.rule_idx));
                }
            }
        });

        if let Some((_, winner_idx)) = best_candidate {
            let r = &self.rules[winner_idx].rule;
            decision.rule_id = r.id;
            decision.action = u32::from(r.action == "block");
            decision.log_matches = u32::from(r.action == "log" || r.log);
        }

        Ok(decision)
    }
}
