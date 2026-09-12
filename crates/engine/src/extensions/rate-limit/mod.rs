//! In-process Rate Limiting Engine for Aurora WAF.
//!
//! Features:
//! - Pluggable algorithms: Token Bucket, Leaky Bucket, Fixed Window, Sliding Window
//! - Bounded memory with Sharded partition store (16 shards) to eliminate lock contention
//! - Configurable Eviction (TTL-first, LRU, LFU, FIFO)
//! - Configurable Overflow strategy (EvictAndTrack, DropNew, BypassNew)
//! - Configurable Actions on exceeded (Throttle 429, Block 403, Audit, CustomResponse)

use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::SystemTime;

const NUM_SHARDS: usize = 16;
const MAX_RATE_LIMIT_RULES: usize = 64;
const MAX_RATE_LIMIT_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum RateLimitAlgorithm {
    #[default]
    TokenBucket,
    LeakyBucket,
    FixedWindow,
    SlidingWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EvictionPolicy {
    #[default]
    Lru,
    Lfu,
    Fifo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OverflowStrategy {
    #[default]
    EvictAndTrack,
    DropNew,
    BypassNew,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ActionOnExceeded {
    #[default]
    Throttle,
    Block,
    Audit,
    CustomResponse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum LimitBy {
    #[default]
    ClientIp,
    ApiKey,
    Authorization,
    RoutePath,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    generation: u64,
    algorithm: RateLimitAlgorithm,
    memory_size_mb: u32,
    max_keys: usize,
    eviction_policy: EvictionPolicy,
    overflow_strategy: OverflowStrategy,
    rules: Vec<RuleInput>,
}

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct RuleInput {
    id: String,
    #[serde(default)]
    priority: u32,
    host: String,
    path_prefix: String,
    limit_by: String,
    rate: u64,
    period_secs: u64,
    #[serde(default)]
    burst: Option<u64>,
    action_on_exceeded: ActionOnExceeded,
    #[serde(default)]
    rejected_code: Option<u16>,
    #[serde(default)]
    custom_message: Option<String>,
}

#[derive(Clone)]
struct CompiledRule {
    #[allow(dead_code)]
    id: String,
    host: Vec<u8>,
    path_prefix: Vec<u8>,
    limit_by: LimitBy,
    rate: u64,
    period_secs: u64,
    burst: u64,
    action_on_exceeded: ActionOnExceeded,
    rejected_code: u16,
    #[allow(dead_code)]
    custom_message: Option<String>,
}

#[derive(Clone)]
enum AlgorithmState {
    TokenBucket {
        tokens: f64,
        last_refill_ms: u64,
    },
    LeakyBucket {
        water_level: f64,
        last_leak_ms: u64,
    },
    FixedWindow {
        window_id: u64,
        count: u64,
    },
    SlidingWindow {
        window_id: u64,
        current_count: u64,
        previous_count: u64,
    },
}

struct ShardEntry {
    state: AlgorithmState,
    last_access_secs: u64,
    access_count: u64,
    created_at_secs: u64,
}

struct Shard {
    entries: HashMap<(usize, Vec<u8>), ShardEntry>,
}

pub struct RateLimitEngine {
    generation: u64,
    algorithm: RateLimitAlgorithm,
    max_keys_per_shard: usize,
    eviction_policy: EvictionPolicy,
    overflow_strategy: OverflowStrategy,
    rules: Vec<CompiledRule>,
    shards: Vec<Mutex<Shard>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub action: ActionOnExceeded,
    pub status_code: u16,
    pub retry_after_secs: u32,
    pub remaining: u32,
    pub reset_epoch_secs: u64,
}

fn now_epoch_secs_and_ms() -> (u64, u64) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs(), now.as_millis() as u64)
}

fn hash_key(rule_idx: usize, key: &[u8]) -> usize {
    let mut h: u64 = 0xcbf29ce484222325;
    h = (h ^ (rule_idx as u64)).wrapping_mul(0x100000001b3);
    for &b in key {
        h = (h ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    (h as usize) % NUM_SHARDS
}

impl RateLimitEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_RATE_LIMIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let mut snapshot: Snapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        if snapshot.schema_version != 1
            || snapshot.generation == 0
            || snapshot.generation > i64::MAX as u64
            || snapshot.rules.is_empty()
            || snapshot.rules.len() > MAX_RATE_LIMIT_RULES
        {
            return Err(Error::InvalidPolicy);
        }

        // Memory budget bounds: strictly enforce without clamping or silent shrinking
        if snapshot.memory_size_mb == 0
            || snapshot.memory_size_mb > 1024
            || snapshot.max_keys < 16
            || snapshot.max_keys > 5_000_000
        {
            return Err(Error::InvalidPolicy);
        }

        let mb_keys = (snapshot.memory_size_mb as usize * 1024 * 1024) / 128;
        if snapshot.max_keys > mb_keys {
            return Err(Error::InvalidPolicy);
        }

        let total_max_keys = snapshot.max_keys;
        let max_keys_per_shard = total_max_keys / NUM_SHARDS;
        if max_keys_per_shard == 0 {
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

            let rejected_code = match rule.rejected_code {
                Some(code) if (200..=599).contains(&code) => code,
                Some(_) => return Err(Error::InvalidPolicy),
                None => match rule.action_on_exceeded {
                    ActionOnExceeded::Throttle => 429,
                    ActionOnExceeded::Block => 403,
                    ActionOnExceeded::Audit => 200,
                    ActionOnExceeded::CustomResponse => 429,
                },
            };

            if rule.rate == 0
                || rule.period_secs == 0
                || rule.period_secs > 86400
                || !host_valid
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule.path_prefix.bytes().any(|b| b <= 32 || b >= 127)
            {
                return Err(Error::InvalidPolicy);
            }

            if rule
                .custom_message
                .as_deref()
                .is_some_and(|msg| msg.len() > 1024)
            {
                return Err(Error::InvalidPolicy);
            }

            let limit_by = match rule.limit_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => LimitBy::ClientIp,
                "api_key" => LimitBy::ApiKey,
                "authorization" => LimitBy::Authorization,
                "route_path" => LimitBy::RoutePath,
                _ => return Err(Error::InvalidPolicy),
            };

            let burst = match rule.burst {
                Some(0) => return Err(Error::InvalidPolicy),
                Some(b) if b < rule.rate => return Err(Error::InvalidPolicy),
                Some(b) => b,
                None => rule.rate,
            };

            rules.push(CompiledRule {
                id: rule.id,
                host: rule.host.into_bytes(),
                path_prefix: rule.path_prefix.into_bytes(),
                limit_by,
                rate: rule.rate,
                period_secs: rule.period_secs,
                burst,
                action_on_exceeded: rule.action_on_exceeded,
                rejected_code,
                custom_message: rule.custom_message,
            });
        }

        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(Mutex::new(Shard {
                entries: HashMap::new(),
            }));
        }

        Ok(Self {
            generation: snapshot.generation,
            algorithm: snapshot.algorithm,
            max_keys_per_shard,
            eviction_policy: snapshot.eviction_policy,
            overflow_strategy: snapshot.overflow_strategy,
            rules,
            shards,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate(
        &self,
        host: &[u8],
        path: &[u8],
        client_ip: &[u8],
        api_key: Option<&[u8]>,
        authorization: Option<&[u8]>,
    ) -> Result<RateLimitDecision, Error> {
        if host.len() > 253
            || host.contains(&0)
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || path[0] != b'/'
            || path.contains(&0)
            || client_ip.is_empty()
            || client_ip.len() > 64
            || client_ip.contains(&0)
        {
            return Err(Error::InvalidRequest);
        }

        let (now_secs, now_ms) = now_epoch_secs_and_ms();

        let mut matched_any = false;
        let mut min_remaining = u32::MAX;
        let mut max_reset_epoch = 0;
        let mut audit_decision = None;

        for (idx, rule) in self.rules.iter().enumerate() {
            if !host_matches(&rule.host, host) || !path_matches(&rule.path_prefix, path) {
                continue;
            }

            matched_any = true;
            let identifier: &[u8] = match &rule.limit_by {
                LimitBy::ClientIp => client_ip,
                LimitBy::RoutePath => path,
                LimitBy::ApiKey => match api_key {
                    Some(k) if !k.is_empty() => k,
                    _ => return Err(Error::InvalidRequest),
                },
                LimitBy::Authorization => match authorization {
                    Some(a) if !a.is_empty() => a,
                    _ => return Err(Error::InvalidRequest),
                },
            };

            let decision = self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms);
            if !decision.allowed {
                return Ok(decision);
            }
            if decision.remaining < min_remaining {
                min_remaining = decision.remaining;
            }
            if decision.reset_epoch_secs > max_reset_epoch {
                max_reset_epoch = decision.reset_epoch_secs;
            }
            if decision.action == ActionOnExceeded::Audit {
                audit_decision = Some(decision);
            }
        }

        if let Some(mut audit) = audit_decision {
            audit.remaining = min_remaining;
            audit.reset_epoch_secs = max_reset_epoch;
            return Ok(audit);
        }

        if !matched_any {
            return Ok(RateLimitDecision {
                allowed: true,
                action: ActionOnExceeded::Throttle,
                status_code: 200,
                retry_after_secs: 0,
                remaining: u32::MAX,
                reset_epoch_secs: 0,
            });
        }

        Ok(RateLimitDecision {
            allowed: true,
            action: ActionOnExceeded::Throttle,
            status_code: 200,
            retry_after_secs: 0,
            remaining: min_remaining,
            reset_epoch_secs: max_reset_epoch,
        })
    }

    fn evaluate_rule_shard(
        &self,
        rule_idx: usize,
        rule: &CompiledRule,
        identifier: &[u8],
        now_secs: u64,
        now_ms: u64,
    ) -> RateLimitDecision {
        let shard_idx = hash_key(rule_idx, identifier);
        let mut shard = self.shards[shard_idx].lock().unwrap();

        let map_key = (rule_idx, identifier.to_vec());

        if !shard.entries.contains_key(&map_key) {
            // Check capacity
            if shard.entries.len() >= self.max_keys_per_shard {
                // 1. TTL-first sweep
                let ttl_threshold = now_secs.saturating_sub(rule.period_secs * 2);
                shard
                    .entries
                    .retain(|_, entry| entry.last_access_secs > ttl_threshold);

                // 2. If still at capacity, apply overflow strategy
                if shard.entries.len() >= self.max_keys_per_shard {
                    match self.overflow_strategy {
                        OverflowStrategy::BypassNew => {
                            return RateLimitDecision {
                                allowed: true,
                                action: ActionOnExceeded::Throttle,
                                status_code: 200,
                                retry_after_secs: 0,
                                remaining: 1,
                                reset_epoch_secs: now_secs + rule.period_secs,
                            };
                        }
                        OverflowStrategy::DropNew => {
                            return RateLimitDecision {
                                allowed: false,
                                action: rule.action_on_exceeded,
                                status_code: rule.rejected_code,
                                retry_after_secs: rule.period_secs as u32,
                                remaining: 0,
                                reset_epoch_secs: now_secs + rule.period_secs,
                            };
                        }
                        OverflowStrategy::EvictAndTrack => {
                            // Find target key by EvictionPolicy
                            let victim_key = match self.eviction_policy {
                                EvictionPolicy::Lru => shard
                                    .entries
                                    .iter()
                                    .min_by_key(|(_, e)| e.last_access_secs)
                                    .map(|(k, _)| k.clone()),
                                EvictionPolicy::Lfu => shard
                                    .entries
                                    .iter()
                                    .min_by_key(|(_, e)| e.access_count)
                                    .map(|(k, _)| k.clone()),
                                EvictionPolicy::Fifo => shard
                                    .entries
                                    .iter()
                                    .min_by_key(|(_, e)| e.created_at_secs)
                                    .map(|(k, _)| k.clone()),
                            };
                            if let Some(vk) = victim_key {
                                shard.entries.remove(&vk);
                            }
                        }
                    }
                }
            }

            // Initialize new entry
            let init_state = match self.algorithm {
                RateLimitAlgorithm::TokenBucket => AlgorithmState::TokenBucket {
                    tokens: rule.burst as f64,
                    last_refill_ms: now_ms,
                },
                RateLimitAlgorithm::LeakyBucket => AlgorithmState::LeakyBucket {
                    water_level: 0.0,
                    last_leak_ms: now_ms,
                },
                RateLimitAlgorithm::FixedWindow => AlgorithmState::FixedWindow {
                    window_id: now_secs / rule.period_secs,
                    count: 0,
                },
                RateLimitAlgorithm::SlidingWindow => AlgorithmState::SlidingWindow {
                    window_id: now_secs / rule.period_secs,
                    current_count: 0,
                    previous_count: 0,
                },
            };

            shard.entries.insert(
                map_key.clone(),
                ShardEntry {
                    state: init_state,
                    last_access_secs: now_secs,
                    access_count: 0,
                    created_at_secs: now_secs,
                },
            );
        }

        let entry = shard.entries.get_mut(&map_key).unwrap();
        entry.last_access_secs = now_secs;
        entry.access_count += 1;

        match &mut entry.state {
            AlgorithmState::TokenBucket {
                tokens,
                last_refill_ms,
            } => {
                let capacity = rule.burst as f64;
                let refill_rate = rule.rate as f64 / rule.period_secs as f64;
                let elapsed_secs = (now_ms.saturating_sub(*last_refill_ms)) as f64 / 1000.0;
                *tokens = (*tokens + elapsed_secs * refill_rate).min(capacity);
                *last_refill_ms = now_ms;

                if *tokens >= 1.0 {
                    *tokens -= 1.0;
                    let remaining = tokens.floor() as u32;
                    let reset_epoch = now_secs + ((capacity - *tokens) / refill_rate).ceil() as u64;
                    RateLimitDecision {
                        allowed: true,
                        action: ActionOnExceeded::Throttle,
                        status_code: 200,
                        retry_after_secs: 0,
                        remaining,
                        reset_epoch_secs: reset_epoch,
                    }
                } else {
                    let retry_after = ((1.0 - *tokens) / refill_rate).ceil().max(1.0) as u32;
                    build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64)
                }
            }
            AlgorithmState::LeakyBucket {
                water_level,
                last_leak_ms,
            } => {
                let capacity = rule.burst as f64;
                let leak_rate = rule.rate as f64 / rule.period_secs as f64;
                let elapsed_secs = (now_ms.saturating_sub(*last_leak_ms)) as f64 / 1000.0;
                *water_level = (*water_level - elapsed_secs * leak_rate).max(0.0);
                *last_leak_ms = now_ms;

                if *water_level + 1.0 <= capacity {
                    *water_level += 1.0;
                    let remaining = (capacity - *water_level).floor() as u32;
                    let reset_epoch = now_secs + (*water_level / leak_rate).ceil() as u64;
                    RateLimitDecision {
                        allowed: true,
                        action: ActionOnExceeded::Throttle,
                        status_code: 200,
                        retry_after_secs: 0,
                        remaining,
                        reset_epoch_secs: reset_epoch,
                    }
                } else {
                    let retry_after = ((*water_level + 1.0 - capacity) / leak_rate)
                        .ceil()
                        .max(1.0) as u32;
                    build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64)
                }
            }
            AlgorithmState::FixedWindow { window_id, count } => {
                let current_window = now_secs / rule.period_secs;
                if *window_id != current_window {
                    *window_id = current_window;
                    *count = 0;
                }
                let reset_epoch = (*window_id + 1) * rule.period_secs;
                if *count < rule.rate {
                    *count += 1;
                    let remaining = (rule.rate - *count) as u32;
                    RateLimitDecision {
                        allowed: true,
                        action: ActionOnExceeded::Throttle,
                        status_code: 200,
                        retry_after_secs: 0,
                        remaining,
                        reset_epoch_secs: reset_epoch,
                    }
                } else {
                    let retry_after = reset_epoch.saturating_sub(now_secs).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, reset_epoch)
                }
            }
            AlgorithmState::SlidingWindow {
                window_id,
                current_count,
                previous_count,
            } => {
                let current_window = now_secs / rule.period_secs;
                if *window_id != current_window {
                    if current_window == *window_id + 1 {
                        *previous_count = *current_count;
                    } else {
                        *previous_count = 0;
                    }
                    *window_id = current_window;
                    *current_count = 0;
                }

                let time_into_window = (now_secs % rule.period_secs) as f64;
                let weight = 1.0 - (time_into_window / rule.period_secs as f64);
                let estimated_count = (*previous_count as f64 * weight) + *current_count as f64;
                let reset_epoch = (*window_id + 1) * rule.period_secs;

                if estimated_count + 1.0 <= rule.rate as f64 {
                    *current_count += 1;
                    let remaining = (rule.rate as f64 - estimated_count - 1.0).max(0.0) as u32;
                    RateLimitDecision {
                        allowed: true,
                        action: ActionOnExceeded::Throttle,
                        status_code: 200,
                        retry_after_secs: 0,
                        remaining,
                        reset_epoch_secs: reset_epoch,
                    }
                } else {
                    let retry_after = reset_epoch.saturating_sub(now_secs).max(1) as u32;
                    build_exceeded_decision(rule, retry_after, reset_epoch)
                }
            }
        }
    }
}

fn build_exceeded_decision(
    rule: &CompiledRule,
    retry_after: u32,
    reset_epoch: u64,
) -> RateLimitDecision {
    match rule.action_on_exceeded {
        ActionOnExceeded::Audit => RateLimitDecision {
            allowed: true,
            action: ActionOnExceeded::Audit,
            status_code: 200,
            retry_after_secs: retry_after,
            remaining: 0,
            reset_epoch_secs: reset_epoch,
        },
        ActionOnExceeded::Block => RateLimitDecision {
            allowed: false,
            action: ActionOnExceeded::Block,
            status_code: rule.rejected_code,
            retry_after_secs: retry_after,
            remaining: 0,
            reset_epoch_secs: reset_epoch,
        },
        ActionOnExceeded::Throttle => RateLimitDecision {
            allowed: false,
            action: ActionOnExceeded::Throttle,
            status_code: rule.rejected_code,
            retry_after_secs: retry_after,
            remaining: 0,
            reset_epoch_secs: reset_epoch,
        },
        ActionOnExceeded::CustomResponse => RateLimitDecision {
            allowed: false,
            action: ActionOnExceeded::CustomResponse,
            status_code: rule.rejected_code,
            retry_after_secs: retry_after,
            remaining: 0,
            reset_epoch_secs: reset_epoch,
        },
    }
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot(rules: Vec<serde_json::Value>) -> serde_json::Value {
        serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "algorithm": "token_bucket",
            "memory_size_mb": 10,
            "max_keys": 10000,
            "eviction_policy": "lru",
            "overflow_strategy": "evict_and_track",
            "rules": rules
        })
    }

    #[test]
    fn test_token_bucket_rate_limiting() {
        let mut policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "test_tb",
            "host": "*",
            "path_prefix": "/api",
            "limit_by": "client_ip",
            "rate": 2,
            "burst": 3,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        policy_json["algorithm"] = serde_json::json!("token_bucket");

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        let ip = b"10.0.0.1";
        let host = b"example.com";
        let path = b"/api/v1/resource";

        // 1st request -> allow
        let d1 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d1.allowed);

        // 2nd request -> allow
        let d2 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d2.allowed);

        // 3rd request -> allow (burst = 3)
        let d3 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d3.allowed);

        // 4th request -> throttle (burst exceeded)
        let d4 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(!d4.allowed);
        assert_eq!(d4.status_code, 429);
        assert!(d4.retry_after_secs >= 1);
    }

    #[test]
    fn test_fixed_window_rate_limiting() {
        let mut policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "test_fw",
            "host": "*",
            "path_prefix": "/fw",
            "limit_by": "api_key",
            "rate": 2,
            "period_secs": 10,
            "action_on_exceeded": "throttle"
        })]);
        policy_json["algorithm"] = serde_json::json!("fixed_window");

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        let ip = b"10.0.0.1";
        let host = b"example.com";
        let path = b"/fw/test";
        let key = Some(&b"sec-key-123"[..]);

        let d1 = engine.evaluate(host, path, ip, key, None).unwrap();
        assert!(d1.allowed);

        let d2 = engine.evaluate(host, path, ip, key, None).unwrap();
        assert!(d2.allowed);

        let d3 = engine.evaluate(host, path, ip, key, None).unwrap();
        assert!(!d3.allowed);
    }

    #[test]
    fn test_audit_mode_allows_and_marks_action() {
        let policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "audit_rule",
            "host": "*",
            "path_prefix": "/",
            "limit_by": "client_ip",
            "rate": 1,
            "burst": 1,
            "period_secs": 60,
            "action_on_exceeded": "audit"
        })]);

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        let ip = b"192.168.1.100";
        let host = b"audit.local";
        let path = b"/test";

        let d1 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d1.allowed);

        let d2 = engine.evaluate(host, path, ip, None, None).unwrap();
        // In audit mode, request is still allowed!
        assert!(d2.allowed);
        assert_eq!(d2.action, ActionOnExceeded::Audit);
        assert_eq!(d2.remaining, 0);
    }

    #[test]
    fn test_overflow_strategy_drop_new() {
        let mut policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "overflow_rule",
            "host": "*",
            "path_prefix": "/",
            "limit_by": "client_ip",
            "rate": 100,
            "period_secs": 1000,
            "action_on_exceeded": "throttle"
        })]);
        policy_json["algorithm"] = serde_json::json!("fixed_window");
        policy_json["max_keys"] = serde_json::json!(16);
        policy_json["overflow_strategy"] = serde_json::json!("drop_new");

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        // Fill up shard entries by using multiple different IPs
        for i in 0..100 {
            let ip = format!("10.0.{}.{}", i / 256, i % 256);
            let _ = engine.evaluate(b"example.com", b"/test", ip.as_bytes(), None, None);
        }

        let mut had_dropped = false;
        for i in 100..200 {
            let ip = format!("192.168.{}.{}", i / 256, i % 256);
            let d = engine
                .evaluate(b"example.com", b"/test", ip.as_bytes(), None, None)
                .unwrap();
            if !d.allowed {
                had_dropped = true;
                break;
            }
        }
        assert!(
            had_dropped,
            "drop_new should have rejected new keys once full"
        );
    }

    #[test]
    fn test_leaky_bucket_rate_limiting() {
        let mut policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "test_lb",
            "host": "*",
            "path_prefix": "/leaky",
            "limit_by": "client_ip",
            "rate": 2,
            "burst": 3,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        policy_json["algorithm"] = serde_json::json!("leaky_bucket");

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        let ip = b"10.10.10.10";
        let host = b"example.com";
        let path = b"/leaky/data";

        // 1st request -> allowed (water = 1.0)
        let d1 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d1.allowed);

        // 2nd request -> allowed (water = 2.0)
        let d2 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d2.allowed);

        // 3rd request -> allowed (water = 3.0 = capacity)
        let d3 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d3.allowed);

        // 4th request -> throttle (water 4.0 > capacity 3.0)
        let d4 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(!d4.allowed);
        assert_eq!(d4.status_code, 429);
    }

    #[test]
    fn test_sliding_window_rate_limiting() {
        let mut policy_json = sample_snapshot(vec![serde_json::json!({
            "id": "test_sw",
            "host": "*",
            "path_prefix": "/sw",
            "limit_by": "client_ip",
            "rate": 2,
            "period_secs": 10,
            "action_on_exceeded": "block"
        })]);
        policy_json["algorithm"] = serde_json::json!("sliding_window");

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        let ip = b"172.16.0.5";
        let host = b"example.com";
        let path = b"/sw/api";

        let d1 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d1.allowed);

        let d2 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(d2.allowed);

        let d3 = engine.evaluate(host, path, ip, None, None).unwrap();
        assert!(!d3.allowed);
        assert_eq!(d3.status_code, 403); // action_on_exceeded is block
        assert_eq!(d3.action, ActionOnExceeded::Block);
    }

    #[test]
    fn test_invalid_policy_fails_without_fallback() {
        // Unknown limit_by strategy must fail so caller preserves last known good
        let bad_limit_by = sample_snapshot(vec![serde_json::json!({
            "id": "r1",
            "host": "*",
            "path_prefix": "/api",
            "limit_by": "unknown_strategy",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&bad_limit_by).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // burst < rate must fail
        let low_burst = sample_snapshot(vec![serde_json::json!({
            "id": "r1",
            "host": "*",
            "path_prefix": "/api",
            "limit_by": "client_ip",
            "rate": 10,
            "burst": 5,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&low_burst).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // memory_size_mb == 0 must fail
        let mut zero_mem = sample_snapshot(vec![serde_json::json!({
            "id": "r1",
            "host": "*",
            "path_prefix": "/api",
            "limit_by": "client_ip",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        zero_mem["memory_size_mb"] = serde_json::json!(0);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&zero_mem).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // Empty rules must fail
        let empty_rules = sample_snapshot(vec![]);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&empty_rules).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // Duplicate rule IDs must fail
        let dup_rules = sample_snapshot(vec![
            serde_json::json!({
                "id": "r1",
                "host": "*",
                "path_prefix": "/api1",
                "limit_by": "client_ip",
                "rate": 10,
                "period_secs": 1,
                "action_on_exceeded": "throttle"
            }),
            serde_json::json!({
                "id": "r1",
                "host": "*",
                "path_prefix": "/api2",
                "limit_by": "client_ip",
                "rate": 10,
                "period_secs": 1,
                "action_on_exceeded": "throttle"
            }),
        ]);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&dup_rules).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // Invalid path_prefix without leading slash must fail
        let bad_path = sample_snapshot(vec![serde_json::json!({
            "id": "r1",
            "host": "*",
            "path_prefix": "no_slash",
            "limit_by": "client_ip",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&bad_path).unwrap()),
            Err(Error::InvalidPolicy)
        ));

        // Missing required algorithm must fail
        let mut missing_algo = sample_snapshot(vec![serde_json::json!({
            "id": "r1",
            "host": "*",
            "path_prefix": "/api",
            "limit_by": "client_ip",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        })]);
        missing_algo.as_object_mut().unwrap().remove("algorithm");
        assert!(matches!(
            RateLimitEngine::from_snapshot(&serde_json::to_vec(&missing_algo).unwrap()),
            Err(Error::InvalidPolicy)
        ));
    }

    #[test]
    fn test_request_evaluation_fails_without_fallback() {
        let policy_json = sample_snapshot(vec![
            serde_json::json!({
                "id": "api_key_rule",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "api_key",
                "rate": 10,
                "period_secs": 1,
                "action_on_exceeded": "throttle"
            }),
            serde_json::json!({
                "id": "auth_rule",
                "host": "*",
                "path_prefix": "/secure",
                "limit_by": "authorization",
                "rate": 10,
                "period_secs": 1,
                "action_on_exceeded": "throttle"
            }),
        ]);

        let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
            .expect("load engine");

        // Missing client_ip must fail with InvalidRequest, not fallback to 127.0.0.1
        let err_ip = engine.evaluate(b"example.com", b"/api/test", b"", Some(b"key-1"), None);
        assert!(matches!(err_ip, Err(Error::InvalidRequest)));

        // Missing api_key on api_key rule must fail with InvalidRequest, not fallback to anonymous
        let err_key = engine.evaluate(b"example.com", b"/api/test", b"1.2.3.4", None, None);
        assert!(matches!(err_key, Err(Error::InvalidRequest)));

        let err_empty_key =
            engine.evaluate(b"example.com", b"/api/test", b"1.2.3.4", Some(b""), None);
        assert!(matches!(err_empty_key, Err(Error::InvalidRequest)));

        // Missing authorization on authorization rule must fail with InvalidRequest, not fallback to anonymous
        let err_auth = engine.evaluate(b"example.com", b"/secure/data", b"1.2.3.4", None, None);
        assert!(matches!(err_auth, Err(Error::InvalidRequest)));
    }
}
