//! Companion Shadow Worker for Distributed Rate Limiting via Redis.
//!
//! Enforces cluster-wide eventual consistency using asynchronous batch synchronization:
//! 1. Traffic workers update core-local atomic accumulators with zero Redis network I/O.
//! 2. Shadow worker awakes on timer (e.g. 500ms) OR emergency delta threshold early flush.
//! 3. Pushes aggregated deltas in a single Redis Lua script (`BATCH_RATE_LIMIT_SYNC`),
//!    reducing Redis command overhead by 100x-1000x and reflecting overquota status
//!    back to L1 RAM for instant sub-microsecond edge short-circuiting.

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::Notify;

use super::engine::CacheAligned;
use super::shard::Shard;
use crate::redis_pool::RedisConnectionPool;
use redis::Script;
use std::sync::Mutex;

/// Highly efficient batch synchronization Lua script for Redis.
/// KEYS: Array of rate-limit cluster keys [k1, k2, ..., kN]
/// ARGV: Flat array of [delta, limit, period_secs] triplets matching KEYS
pub const BATCH_RATE_LIMIT_SYNC_SCRIPT: &str = r#"
local blocked = {}
for i = 1, #KEYS do
    local key = KEYS[i]
    local delta = tonumber(ARGV[(i - 1) * 3 + 1])
    local limit = tonumber(ARGV[(i - 1) * 3 + 2])
    local period = tonumber(ARGV[(i - 1) * 3 + 3])

    local curr = redis.call("INCRBY", key, delta)
    if curr == delta then
        redis.call("EXPIRE", key, period * 2 + 1)
    end
    if curr > limit then
        table.insert(blocked, key)
    end
end
return blocked
"#;

/// Asynchronous shadow sync task keeping L1 in-memory counters synchronized with Redis.
pub async fn run_rate_limit_redis_shadow_sync(
    shards: Arc<Vec<CacheAligned<Mutex<Shard>>>>,
    pool: Arc<RedisConnectionPool>,
    early_flush: Arc<Notify>,
    sync_interval: Duration,
) {
    let script = Script::new(BATCH_RATE_LIMIT_SYNC_SCRIPT);

    loop {
        // Dual-trigger: wait for periodic heartbeat timer OR early emergency flush
        tokio::select! {
            _ = tokio::time::sleep(sync_interval) => {},
            _ = early_flush.notified() => {},
        }

        // 1. Harvest deltas from 16 local shards without holding locks long
        let mut batch_keys = Vec::new();
        let mut batch_args = Vec::new();
        let mut tracked_entries = Vec::new();

        for (shard_idx, cache_shard) in shards.iter().enumerate() {
            if let Ok(shard) = cache_shard.0.try_lock() {
                for (key, entry) in shard.entries.iter() {
                    let delta = entry.pending_delta.swap(0, Ordering::AcqRel);
                    if delta > 0 {
                        let id_str = String::from_utf8_lossy(&key.1);
                        let key_str = format!("aurora:rl:cluster:{}:{id_str}", key.0);
                        batch_keys.push(key_str.clone());
                        batch_args.push(delta as i64);
                        batch_args.push(entry.rule_rate as i64);
                        batch_args.push(entry.rule_period_secs as i64);
                        tracked_entries.push((shard_idx, key.clone(), key_str));
                    }
                }
            }
        }

        if batch_keys.is_empty() {
            continue;
        }

        // 2. Execute single batch Lua command against Redis
        if let Ok(mut conn) = pool.get_connection() {
            let mut invocation = script.prepare_invoke();
            for k in &batch_keys {
                invocation.key(k);
            }
            for arg in &batch_args {
                invocation.arg(*arg);
            }

            if let Ok(blocked_keys) = invocation.invoke::<Vec<String>>(&mut conn) {
                let blocked_set: HashSet<String> = blocked_keys.into_iter().collect();

                // 3. Reflect cluster blocked status back into local L1 shards
                for (shard_idx, key, key_str) in tracked_entries {
                    if let Ok(mut shard) = shards[shard_idx].0.try_lock()
                        && let Some(entry) = shard.entries.get_mut(&key)
                    {
                        let is_blocked = blocked_set.contains(&key_str);
                        entry.cluster_blocked.store(is_blocked, Ordering::Release);
                    }
                }
            }
            pool.return_connection(conn);
        }
    }
}
