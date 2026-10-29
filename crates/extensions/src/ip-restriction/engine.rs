//! IP Restriction Evaluation Engine
//!
//! Provides high-performance, flat array-based IP access control with zero-allocation
//! hot path evaluation and instant early-exit short-circuiting.

use super::config::{IpRestrictionRequest, IpRestrictionSnapshot, normalize_cidr_string};
use super::ip::{ParsedIp, parse_client_ip, parse_ipv4_cidr, parse_ipv6_cidr};
use super::rule::{FlatIpv4Rule, FlatIpv6Rule, HostMatcher, method_to_mask};
use crate::{AccessRequestContext, Decision, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES};
use std::collections::HashSet;

pub struct IpRestrictionEngine {
    generation: u64,
    rules_v4: Vec<FlatIpv4Rule>,
    rules_v6: Vec<FlatIpv6Rule>,
    is_whitelist_strict: bool,
}

#[derive(Clone, Debug)]
struct UnifiedRuleInput {
    id: u64,
    priority: u32,
    is_block: bool,
    networks: Vec<String>,
    path_prefix: String,
    host: String,
    method: String,
    log: bool,
}

impl IpRestrictionEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let snap: IpRestrictionSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snap.schema_version != 1 || snap.generation > i64::MAX as u64 {
            return Err(Error::InvalidPolicy);
        }

        let mut unified_inputs = Vec::new();
        let mut has_declarative_whitelist = false;
        let mut has_declarative_blacklist = false;

        // 1. Declarative Whitelist
        for (i, cidr) in snap.whitelist.into_iter().enumerate() {
            if let Some(norm) = normalize_cidr_string(&cidr) {
                has_declarative_whitelist = true;
                unified_inputs.push(UnifiedRuleInput {
                    id: 10_000 + i as u64,
                    priority: 10,
                    is_block: false,
                    networks: vec![norm],
                    path_prefix: "/".to_string(),
                    host: "*".to_string(),
                    method: "*".to_string(),
                    log: false,
                });
            }
        }

        // 2. Declarative Blacklist
        for (i, cidr) in snap.blacklist.into_iter().enumerate() {
            if let Some(norm) = normalize_cidr_string(&cidr) {
                has_declarative_blacklist = true;
                unified_inputs.push(UnifiedRuleInput {
                    id: 20_000 + i as u64,
                    priority: 20,
                    is_block: true,
                    networks: vec![norm],
                    path_prefix: "/".to_string(),
                    host: "*".to_string(),
                    method: "*".to_string(),
                    log: false,
                });
            }
        }

        // 3. Custom / Configured Rules
        for (i, cfg_rule) in snap.rules.into_iter().enumerate() {
            if cfg_rule.enabled == Some(false) {
                continue;
            }

            let mut id = match cfg_rule.id {
                serde_json::Value::Number(n) => n.as_u64().unwrap_or(30_000 + i as u64),
                serde_json::Value::String(ref s) => s.parse::<u64>().unwrap_or_else(|_| {
                    let mut hasher = std::collections::hash_map::DefaultHasher::new();
                    std::hash::Hash::hash(s, &mut hasher);
                    std::hash::Hasher::finish(&hasher)
                }),
                _ => 30_000 + i as u64,
            };
            if id == 0 {
                id = 30_000 + i as u64;
            }

            let mut networks = Vec::new();
            if !cfg_rule.networks.is_empty() {
                for net in cfg_rule.networks {
                    if let Some(norm) = normalize_cidr_string(&net) {
                        networks.push(norm);
                    }
                }
            } else if !cfg_rule.cidr.is_empty()
                && let Some(norm) = normalize_cidr_string(&cfg_rule.cidr)
            {
                networks.push(norm);
            }

            if networks.is_empty() {
                continue;
            }

            let path_prefix = if let Some(p) = cfg_rule.path_prefix {
                if p.is_empty() { "/".to_string() } else { p }
            } else if !cfg_rule.match_value.is_empty() {
                cfg_rule.match_value
            } else {
                "/".to_string()
            };

            let priority = cfg_rule.priority.unwrap_or(100 + i as u32);
            let is_block = if cfg_rule.action.is_empty() {
                false
            } else {
                cfg_rule.action == "block"
            };

            if is_block {
                has_declarative_blacklist = true;
            } else {
                has_declarative_whitelist = true;
            }

            unified_inputs.push(UnifiedRuleInput {
                id,
                priority,
                is_block,
                networks,
                path_prefix,
                host: cfg_rule.host,
                method: cfg_rule.method,
                log: cfg_rule.log,
            });
        }

        if unified_inputs.len() > 512 {
            return Err(Error::InvalidPolicy);
        }

        let mut rules_v4 = Vec::new();
        let mut rules_v6 = Vec::new();
        let mut ids = HashSet::new();

        for rule in unified_inputs {
            let host_matcher = HostMatcher::parse(&rule.host).ok_or(Error::InvalidPolicy)?;

            if rule.id == 0
                || !ids.insert(rule.id)
                || rule.networks.is_empty()
                || rule.networks.len() > 4096
                || rule.priority > 1_000_000
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule
                    .path_prefix
                    .bytes()
                    .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
                || rule.path_prefix.contains("//")
                || rule.path_prefix.split('/').any(|s| s == "." || s == "..")
            {
                return Err(Error::InvalidPolicy);
            }

            let method_mask = method_to_mask(rule.method.as_bytes());
            if method_mask == 0 {
                return Err(Error::InvalidPolicy);
            }

            for cidr in &rule.networks {
                if let Some((network, mask, prefix_len)) = parse_ipv4_cidr(cidr) {
                    rules_v4.push(FlatIpv4Rule {
                        mask,
                        network,
                        prefix_len,
                        priority: rule.priority,
                        is_block: rule.is_block,
                        rule_id: rule.id,
                        method_mask,
                        host: host_matcher.clone(),
                        path_prefix: rule.path_prefix.as_bytes().to_vec(),
                        log: rule.log,
                    });
                } else if let Some((network, mask, prefix_len)) = parse_ipv6_cidr(cidr) {
                    rules_v6.push(FlatIpv6Rule {
                        mask,
                        network,
                        prefix_len,
                        priority: rule.priority,
                        is_block: rule.is_block,
                        rule_id: rule.id,
                        method_mask,
                        host: host_matcher.clone(),
                        path_prefix: rule.path_prefix.as_bytes().to_vec(),
                        log: rule.log,
                    });
                } else {
                    return Err(Error::InvalidPolicy);
                }
            }
        }

        // Sort rules for natural Longest Prefix Match (LPM) and Priority:
        // 1. Smaller priority first (e.g. priority 5 beats priority 10)
        // 2. Larger prefix_len first (LPM: /32 beats /24, /24 beats /16)
        // 3. Smaller rule_id first (deterministic tie-breaker)
        rules_v4.sort_by_key(|r| (r.priority, std::cmp::Reverse(r.prefix_len), r.rule_id));
        rules_v6.sort_by_key(|r| (r.priority, std::cmp::Reverse(r.prefix_len), r.rule_id));

        let is_whitelist_strict = has_declarative_whitelist && !has_declarative_blacklist;

        Ok(Self {
            generation: snap.generation,
            rules_v4,
            rules_v6,
            is_whitelist_strict,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline]
    pub fn evaluate_ctx(&self, ctx: &AccessRequestContext<'_>) -> Result<Decision, Error> {
        self.evaluate(IpRestrictionRequest {
            ip: ctx.client_ip,
            host: ctx.host,
            path: ctx.path,
            method: ctx.method,
            now: ctx.now_ms / 1000,
        })
    }

    pub fn evaluate(&self, q: IpRestrictionRequest<'_>) -> Result<Decision, Error> {
        if q.path.is_empty()
            || q.path.len() > MAX_PATH_BYTES
            || q.path[0] != b'/'
            || q.host.len() > 253
            || q.method.len() > 16
        {
            return Err(Error::InvalidRequest);
        }

        let parsed_ip = parse_client_ip(q.ip).ok_or(Error::InvalidRequest)?;
        let req_method_mask = method_to_mask(q.method);

        match parsed_ip {
            ParsedIp::V4(ip_v4) => {
                for rule in &self.rules_v4 {
                    if rule.matches(ip_v4, req_method_mask, q.host, q.path) {
                        return Ok(Decision {
                            rule_id: rule.rule_id,
                            action: u32::from(rule.is_block),
                            log_matches: u32::from(rule.log),
                            generation: self.generation,
                            ..Default::default()
                        });
                    }
                }
            }
            ParsedIp::V6(ip_v6) => {
                for rule in &self.rules_v6 {
                    if rule.matches(ip_v6, req_method_mask, q.host, q.path) {
                        return Ok(Decision {
                            rule_id: rule.rule_id,
                            action: u32::from(rule.is_block),
                            log_matches: u32::from(rule.log),
                            generation: self.generation,
                            ..Default::default()
                        });
                    }
                }
            }
        }

        // Branchless fallback when no rule matched: strict whitelist denies (1), otherwise allows (0)
        Ok(Decision {
            rule_id: 0,
            action: u32::from(self.is_whitelist_strict),
            log_matches: 0,
            generation: self.generation,
            ..Default::default()
        })
    }
}
