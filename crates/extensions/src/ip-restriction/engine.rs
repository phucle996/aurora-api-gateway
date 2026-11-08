//! IP Restriction Evaluation Engine
//!
//! Provides high-performance, two-tier numerical IP access control ($O(1)$ static IPs
//! and mask-partitioned branch-and-bound subnets) with zero heap allocations on
//! hot path evaluation and instant early-exit short-circuiting.

use super::ip::{ParsedIp, parse_client_ip, parse_ipv4_cidr, parse_ipv6_cidr};
use super::policy::{IpRestrictionPolicy, IpRestrictionRequest, normalize_cidr_string};
use super::rule::{FlatIpv4Rule, FlatIpv6Rule, HostMatcher, METHOD_ALL, method_to_mask};
use crate::{AccessRequestContext, Decision, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES};
use rustc_hash::FxHashMap;
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct Ipv4MaskPartition {
    pub mask: u32,
    pub min_rule_idx: usize,
    pub network_map: FxHashMap<u32, Vec<usize>>,
}

#[derive(Clone, Debug)]
pub struct Ipv4Matcher {
    rules: Vec<FlatIpv4Rule>,
    partitions: Vec<Ipv4MaskPartition>,
}

impl Ipv4Matcher {
    pub fn new(rules: Vec<FlatIpv4Rule>) -> Self {
        if rules.is_empty() {
            return Self {
                rules,
                partitions: Vec::new(),
            };
        }

        let mut partition_map: FxHashMap<u32, FxHashMap<u32, Vec<usize>>> = FxHashMap::default();
        for (idx, rule) in rules.iter().enumerate() {
            partition_map
                .entry(rule.mask)
                .or_default()
                .entry(rule.network)
                .or_default()
                .push(idx);
        }

        let mut partitions = Vec::with_capacity(partition_map.len());
        for (mask, network_map) in partition_map {
            let mut min_rule_idx = usize::MAX;
            for indices in network_map.values() {
                if let Some(&first) = indices.first()
                    && first < min_rule_idx
                {
                    min_rule_idx = first;
                }
            }
            partitions.push(Ipv4MaskPartition {
                mask,
                min_rule_idx,
                network_map,
            });
        }

        // Sort partitions by min_rule_idx ascending:
        // Guarantees that the partition containing the highest priority rule is inspected first.
        partitions.sort_by_key(|p| p.min_rule_idx);

        Self { rules, partitions }
    }

    #[inline(always)]
    pub fn evaluate(
        &self,
        ip: u32,
        req_method_mask: u16,
        host: &[u8],
        path: &[u8],
    ) -> Option<&FlatIpv4Rule> {
        let mut best_index = usize::MAX;

        for partition in &self.partitions {
            // Branch-and-bound pruning:
            // If the best matching rule index found so far is <= the lowest possible rule index
            // in this partition, this partition and any subsequent partitions CANNOT contain
            // a better rule!
            if best_index <= partition.min_rule_idx {
                break;
            }

            let net = ip & partition.mask;
            if let Some(rule_indices) = partition.network_map.get(&net) {
                for &idx in rule_indices {
                    if idx >= best_index {
                        break;
                    }

                    // SAFETY: idx was collected from 0..self.rules.len() and self.rules is immutable.
                    let rule = unsafe { self.rules.get_unchecked(idx) };
                    if rule.matches_request(req_method_mask, host, path) {
                        best_index = idx;
                        // Rule index 0 is the absolute top priority rule: nothing can beat it.
                        if best_index == 0 {
                            return Some(rule);
                        }
                        break;
                    }
                }
            }
        }

        if best_index != usize::MAX {
            // SAFETY: best_index is a verified index into self.rules.
            Some(unsafe { self.rules.get_unchecked(best_index) })
        } else {
            None
        }
    }
}

#[derive(Clone, Debug)]
pub struct Ipv6MaskPartition {
    pub mask: u128,
    pub min_rule_idx: usize,
    pub network_map: FxHashMap<u128, Vec<usize>>,
}

#[derive(Clone, Debug)]
pub struct Ipv6Matcher {
    rules: Vec<FlatIpv6Rule>,
    partitions: Vec<Ipv6MaskPartition>,
}

impl Ipv6Matcher {
    pub fn new(rules: Vec<FlatIpv6Rule>) -> Self {
        if rules.is_empty() {
            return Self {
                rules,
                partitions: Vec::new(),
            };
        }

        let mut partition_map: FxHashMap<u128, FxHashMap<u128, Vec<usize>>> = FxHashMap::default();
        for (idx, rule) in rules.iter().enumerate() {
            partition_map
                .entry(rule.mask)
                .or_default()
                .entry(rule.network)
                .or_default()
                .push(idx);
        }

        let mut partitions = Vec::with_capacity(partition_map.len());
        for (mask, network_map) in partition_map {
            let mut min_rule_idx = usize::MAX;
            for indices in network_map.values() {
                if let Some(&first) = indices.first()
                    && first < min_rule_idx
                {
                    min_rule_idx = first;
                }
            }
            partitions.push(Ipv6MaskPartition {
                mask,
                min_rule_idx,
                network_map,
            });
        }

        partitions.sort_by_key(|p| p.min_rule_idx);

        Self { rules, partitions }
    }

    #[inline(always)]
    pub fn evaluate(
        &self,
        ip: u128,
        req_method_mask: u16,
        host: &[u8],
        path: &[u8],
    ) -> Option<&FlatIpv6Rule> {
        let mut best_index = usize::MAX;

        for partition in &self.partitions {
            if best_index <= partition.min_rule_idx {
                break;
            }

            let net = ip & partition.mask;
            if let Some(rule_indices) = partition.network_map.get(&net) {
                for &idx in rule_indices {
                    if idx >= best_index {
                        break;
                    }

                    // SAFETY: idx was collected from 0..self.rules.len() and self.rules is immutable.
                    let rule = unsafe { self.rules.get_unchecked(idx) };
                    if rule.matches_request(req_method_mask, host, path) {
                        best_index = idx;
                        if best_index == 0 {
                            return Some(rule);
                        }
                        break;
                    }
                }
            }
        }

        if best_index != usize::MAX {
            // SAFETY: best_index is a verified index into self.rules.
            Some(unsafe { self.rules.get_unchecked(best_index) })
        } else {
            None
        }
    }
}

pub struct IpRestrictionEngine {
    generation: u64,
    v4_matcher: Ipv4Matcher,
    v6_matcher: Ipv6Matcher,
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

        let snap: IpRestrictionPolicy =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        snap.validate().map_err(|_| Error::InvalidPolicy)?;

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

        if unified_inputs.len() > 65_536 {
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
                || rule.networks.len() > 65_536
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

            let is_pure = (method_mask == METHOD_ALL)
                && (host_matcher == HostMatcher::Any)
                && (rule.path_prefix == "/");

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
                        is_pure,
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
                        is_pure,
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

        let v4_matcher = Ipv4Matcher::new(rules_v4);
        let v6_matcher = Ipv6Matcher::new(rules_v6);
        let is_whitelist_strict = has_declarative_whitelist && !has_declarative_blacklist;

        Ok(Self {
            generation: snap.generation,
            v4_matcher,
            v6_matcher,
            is_whitelist_strict,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[cfg(test)]
    pub fn v4_partitions_count(&self) -> usize {
        self.v4_matcher.partitions.len()
    }

    #[cfg(test)]
    pub fn v6_partitions_count(&self) -> usize {
        self.v6_matcher.partitions.len()
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
                if let Some(rule) = self
                    .v4_matcher
                    .evaluate(ip_v4, req_method_mask, q.host, q.path)
                {
                    return Ok(Decision {
                        rule_id: rule.rule_id,
                        action: u32::from(rule.is_block),
                        log_matches: u32::from(rule.log),
                        generation: self.generation,
                        ..Default::default()
                    });
                }
            }
            ParsedIp::V6(ip_v6) => {
                if let Some(rule) = self
                    .v6_matcher
                    .evaluate(ip_v6, req_method_mask, q.host, q.path)
                {
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
