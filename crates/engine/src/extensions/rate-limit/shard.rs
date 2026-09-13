use crate::extensions::rate_limit::algorithm::AlgorithmState;
use crate::extensions::rate_limit::types::{
    CompiledRule, EvictionPolicy, NUM_SHARDS, OverflowStrategy, RateLimitAlgorithm,
    RateLimitDecision,
};
use hashbrown::{Equivalent, HashMap};
use std::collections::hash_map::RandomState;

// Hashing this tuple struct matches the owned (usize, Vec<u8>) key. Keep the
// rule index in both hash and equality: identical identifiers in different
// rules must never share quota. The borrowed query avoids a key allocation.
#[derive(Hash)]
pub(crate) struct RateLimitKeyRef<'a>(pub usize, pub &'a [u8]);

impl Equivalent<(usize, Vec<u8>)> for RateLimitKeyRef<'_> {
    fn equivalent(&self, key: &(usize, Vec<u8>)) -> bool {
        self.0 == key.0 && self.1 == key.1.as_slice()
    }
}

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
    // Retain randomized hashing for client-controlled identifiers.
    pub entries: HashMap<(usize, Vec<u8>), ShardEntry, RandomState>,
    // Conservative lower bound, not an expiry timestamp: rules can have
    // different periods. Refresh after a sweep; stale bounds only cause an
    // extra sweep, never retention of an entry the old TTL rule would remove.
    pub oldest_access_lower_bound: u64,
}

impl Shard {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::with_hasher(RandomState::new()),
            oldest_access_lower_bound: u64::MAX,
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

// Called only after a miss while the caller holds the shard lock.
pub(crate) fn insert_shard_entry<'a>(
    shard: &'a mut Shard,
    map_key: &RateLimitKeyRef<'_>,
    rule: &CompiledRule,
    cfg: &ShardConfig,
    now_secs: u64,
    now_ms: u64,
) -> Result<&'a mut ShardEntry, RateLimitDecision> {
    if shard.entries.len() >= cfg.max_keys_per_shard {
        // 1. TTL-first sweep
        let ttl_threshold = now_secs.saturating_sub(rule.period_secs * 2);
        if shard.oldest_access_lower_bound <= ttl_threshold {
            let mut oldest = u64::MAX;
            shard.entries.retain(|_, entry| {
                if entry.last_access_secs <= ttl_threshold {
                    return false;
                }
                oldest = oldest.min(entry.last_access_secs);
                true
            });
            shard.oldest_access_lower_bound = oldest;
        }

        // 2. If still at capacity, apply overflow strategy
        if shard.entries.len() >= cfg.max_keys_per_shard {
            match cfg.overflow_strategy {
                OverflowStrategy::BypassNew => {
                    return Err(RateLimitDecision::allow(1, now_secs + rule.period_secs));
                }
                OverflowStrategy::DropNew => {
                    return Err(RateLimitDecision {
                        allowed: false,
                        action: rule.action_on_exceeded,
                        status_code: rule.rejected_code,
                        retry_after_secs: rule.period_secs as u32,
                        remaining: 0,
                        reset_epoch_secs: now_secs + rule.period_secs,
                        custom_reason: None,
                        headers: Vec::new(),
                        body: None,
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
    shard.oldest_access_lower_bound = shard.oldest_access_lower_bound.min(now_secs);
    Ok(shard
        .entries
        .entry((map_key.0, map_key.1.to_vec()))
        .or_insert_with(|| ShardEntry {
            state: init_state,
            last_access_secs: now_secs,
            access_count: 0,
            created_at_secs: now_secs,
        }))
}
