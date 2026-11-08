//! 16-Way Cacheline-Aligned Partition Store & SWAR Key Hashing (Slot 2).
//!
//! Eliminates global lock contention across worker threads by sharding state
//! into 16 independent mutex partitions, indexed via branchless 64-bit SWAR hashing.

use super::algorithm::AlgorithmState;
use super::policy::{
    CompiledRule, EvictionPolicy, NUM_SHARDS, OverflowStrategy, RateLimitAlgorithm,
    RateLimitDecision,
};
use hashbrown::{Equivalent, HashMap};
use std::collections::hash_map::RandomState;
use std::sync::atomic::{AtomicBool, AtomicU32};

/// Borrowed lookup key combining rule index and raw identifier slice.
/// Avoids heap allocation during hash table lookup.
#[derive(Hash)]
pub struct RateLimitKeyRef<'a>(pub usize, pub &'a [u8]);

impl Equivalent<(usize, Vec<u8>)> for RateLimitKeyRef<'_> {
    #[inline]
    fn equivalent(&self, key: &(usize, Vec<u8>)) -> bool {
        self.0 == key.0 && self.1 == key.1.as_slice()
    }
}

pub struct ShardConfig {
    pub max_keys_per_shard: usize,
    pub eviction_policy: EvictionPolicy,
    pub overflow_strategy: OverflowStrategy,
    pub algorithm: RateLimitAlgorithm,
}

pub struct ShardEntry {
    pub state: AlgorithmState,
    pub last_access_secs: u64,
    pub access_count: u64,
    pub created_at_secs: u64,
    pub rule_rate: u64,
    pub rule_period_secs: u64,
    pub pending_delta: AtomicU32,
    pub cluster_blocked: AtomicBool,
}

pub struct Shard {
    /// Hash table retaining randomized hashing against HashDoS.
    pub entries: HashMap<(usize, Vec<u8>), ShardEntry, RandomState>,
    /// Conservative lower bound for TTL sweeps.
    pub oldest_access_lower_bound: u64,
}

impl Default for Shard {
    fn default() -> Self {
        Self::new()
    }
}

impl Shard {
    pub fn new() -> Self {
        Self {
            entries: HashMap::with_hasher(RandomState::new()),
            oldest_access_lower_bound: u64::MAX,
        }
    }
}

/// Computes the 16-way shard index using 64-bit SWAR chunking (8 bytes/step).
#[inline(always)]
pub fn hash_key(rule_idx: usize, key: &[u8]) -> usize {
    let mut h: u64 = 0xcbf29ce484222325 ^ ((rule_idx as u64).wrapping_mul(0x100000001b3));
    let (chunks, remainder) = key.as_chunks::<8>();
    for chunk in chunks {
        let val = u64::from_ne_bytes(*chunk);
        h = (h ^ val).wrapping_mul(0x100000001b3);
    }
    for &b in remainder {
        h = (h ^ (b as u64)).wrapping_mul(0x100000001b3);
    }
    (h as usize) & (NUM_SHARDS - 1)
}

/// Inserts a new entry into the shard upon cache miss.
pub fn insert_shard_entry<'a>(
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
                    return Err(super::algorithm::build_exceeded_decision(
                        rule,
                        rule.period_secs.max(1) as u32,
                        now_secs + rule.period_secs,
                    ));
                }
                OverflowStrategy::EvictAndTrack => match cfg.eviction_policy {
                    EvictionPolicy::Lru => {
                        let victim_key = shard
                            .entries
                            .iter()
                            .min_by_key(|(_, entry)| entry.last_access_secs)
                            .map(|(k, _)| k.clone());
                        if let Some(vk) = victim_key {
                            shard.entries.remove(&vk);
                        }
                    }
                    EvictionPolicy::Lfu => {
                        let victim_key = shard
                            .entries
                            .iter()
                            .min_by_key(|(_, entry)| entry.access_count)
                            .map(|(k, _)| k.clone());
                        if let Some(vk) = victim_key {
                            shard.entries.remove(&vk);
                        }
                    }
                    EvictionPolicy::Fifo => {
                        let victim_key = shard
                            .entries
                            .iter()
                            .min_by_key(|(_, entry)| entry.created_at_secs)
                            .map(|(k, _)| k.clone());
                        if let Some(vk) = victim_key {
                            shard.entries.remove(&vk);
                        }
                    }
                },
            }
        }
    }

    let owned_key = (map_key.0, map_key.1.to_vec());
    let entry = ShardEntry {
        state: AlgorithmState::init(cfg.algorithm, rule, now_secs, now_ms),
        last_access_secs: now_secs,
        access_count: 0,
        created_at_secs: now_secs,
        rule_rate: rule.rate,
        rule_period_secs: rule.period_secs,
        pending_delta: AtomicU32::new(0),
        cluster_blocked: AtomicBool::new(false),
    };

    shard.oldest_access_lower_bound = shard.oldest_access_lower_bound.min(now_secs);
    Ok(shard.entries.entry(owned_key).or_insert(entry))
}
