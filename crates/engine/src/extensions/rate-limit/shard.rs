use crate::extensions::rate_limit::algorithm::AlgorithmState;
use crate::extensions::rate_limit::types::{
    ActionOnExceeded, CompiledRule, EvictionPolicy, OverflowStrategy, RateLimitAlgorithm,
    RateLimitDecision, NUM_SHARDS,
};
use std::collections::HashMap;

pub(crate) struct ShardConfig {
    pub max_keys_per_shard: usize,
    pub eviction_policy: EvictionPolicy,
    pub overflow_strategy: OverflowStrategy,
    pub algorithm: RateLimitAlgorithm,
}

pub(crate) struct ShardEntry {
    pub state: AlgorithmState,
    pub last_access_secs: u64,
    pub access_count: u64,
    pub created_at_secs: u64,
}

pub(crate) struct Shard {
    pub entries: HashMap<(usize, Vec<u8>), ShardEntry>,
}

impl Shard {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

pub(crate) fn hash_key(rule_idx: usize, key: &[u8]) -> usize {
    let mut h: u64 = 0xcbf29ce484222325;
    h = (h ^ (rule_idx as u64)).wrapping_mul(0x100000001b3);
    for &b in key {
        h = (h ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    (h as usize) % NUM_SHARDS
}

pub(crate) fn ensure_shard_capacity_and_entry<'a>(
    shard: &'a mut Shard,
    map_key: &(usize, Vec<u8>),
    rule: &CompiledRule,
    cfg: &ShardConfig,
    now_secs: u64,
    now_ms: u64,
) -> Result<&'a mut ShardEntry, RateLimitDecision> {
    if !shard.entries.contains_key(map_key) {
        if shard.entries.len() >= cfg.max_keys_per_shard {
            // 1. TTL-first sweep
            let ttl_threshold = now_secs.saturating_sub(rule.period_secs * 2);
            shard
                .entries
                .retain(|_, entry| entry.last_access_secs > ttl_threshold);

            // 2. If still at capacity, apply overflow strategy
            if shard.entries.len() >= cfg.max_keys_per_shard {
                match cfg.overflow_strategy {
                    OverflowStrategy::BypassNew => {
                        return Err(RateLimitDecision {
                            allowed: true,
                            action: ActionOnExceeded::Throttle,
                            status_code: 200,
                            retry_after_secs: 0,
                            remaining: 1,
                            reset_epoch_secs: now_secs + rule.period_secs,
                        });
                    }
                    OverflowStrategy::DropNew => {
                        return Err(RateLimitDecision {
                            allowed: false,
                            action: rule.action_on_exceeded,
                            status_code: rule.rejected_code,
                            retry_after_secs: rule.period_secs as u32,
                            remaining: 0,
                            reset_epoch_secs: now_secs + rule.period_secs,
                        });
                    }
                    OverflowStrategy::EvictAndTrack => {
                        let victim_key = match cfg.eviction_policy {
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

        let init_state = AlgorithmState::init(cfg.algorithm, rule, now_secs, now_ms);
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

    Ok(shard.entries.get_mut(map_key).unwrap())
}
