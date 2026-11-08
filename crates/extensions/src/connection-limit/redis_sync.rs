//! Companion Shadow Worker for Distributed Connection Limiting via Redis.
//!
//! Enforces cluster-wide eventual consistency using asynchronous batch synchronization:
//! 1. Traffic workers update core-local atomic accumulators with zero Redis network I/O.
//! 2. Shadow worker awakes on timer (e.g. 500ms).
//! 3. Pushes active in-flight counts in a single Redis Lua script (`BATCH_CONN_LIMIT_SYNC`),
//!    aggregating cluster-wide connections across all gateway nodes, and reflecting overquota status
//!    back to L1 RAM for instant sub-microsecond edge short-circuiting.

use rustc_hash::FxHashSet;
use std::sync::Arc;
use std::time::Duration;

use super::tracker::ShardedConnTracker;
use crate::redis_pool::RedisConnectionPool;
use redis::Script;

pub const BATCH_CONN_LIMIT_SYNC_SCRIPT: &str = r#"
local blocked = {}
local worker_id = ARGV[1]
local ttl = tonumber(ARGV[2])
local n = #KEYS

for i = 1, n do
    local key = KEYS[i]
    local count = tonumber(ARGV[2 + (i - 1) * 2 + 1])
    local limit = tonumber(ARGV[2 + (i - 1) * 2 + 2])

    if count > 0 then
        redis.call("HSET", key, worker_id, count)
        redis.call("EXPIRE", key, ttl)
    else
        redis.call("HDEL", key, worker_id)
    end

    local vals = redis.call("HVALS", key)
    local total = 0
    for j = 1, #vals do
        total = total + tonumber(vals[j])
    end

    if total >= limit then
        table.insert(blocked, key)
    end
end
return blocked
"#;

pub async fn run_conn_limit_redis_shadow_sync(
    tracker: Arc<ShardedConnTracker>,
    pool: Arc<RedisConnectionPool>,
    sync_interval: Duration,
    lease_ttl_secs: u32,
) {
    let script = Script::new(BATCH_CONN_LIMIT_SYNC_SCRIPT);
    let worker_id = format!(
        "w_{:x}_{:x}",
        std::process::id(),
        aurora_engine::current_unix_nano()
    );

    loop {
        tokio::time::sleep(sync_interval).await;

        // 1. Harvest active connection entries from local shards
        let sync_entries = tracker.harvest_sync_entries();
        if sync_entries.is_empty() {
            continue;
        }

        let mut batch_keys = Vec::with_capacity(sync_entries.len());
        let mut tracked_hashes = Vec::with_capacity(sync_entries.len());
        let mut batch_args = Vec::with_capacity(sync_entries.len() * 2 + 2);

        batch_args.push(worker_id.clone());
        batch_args.push(lease_ttl_secs.to_string());

        for (key_hash, key_str, active_count, rule_max) in &sync_entries {
            batch_keys.push(key_str.clone());
            tracked_hashes.push(*key_hash);
            batch_args.push(active_count.to_string());
            batch_args.push(rule_max.to_string());
        }

        // 2. Execute batch Lua command against Redis
        if let Ok(mut conn) = pool.get_connection() {
            let mut invocation = script.prepare_invoke();
            for k in &batch_keys {
                invocation.key(k);
            }
            for arg in &batch_args {
                invocation.arg(arg.as_str());
            }

            if let Ok(blocked_keys) = invocation.invoke::<Vec<String>>(&mut conn) {
                let blocked_set: FxHashSet<&str> =
                    blocked_keys.iter().map(String::as_str).collect();
                let mut blocked_hashes = FxHashSet::default();

                for (key_hash, key_str, _, _) in &sync_entries {
                    if blocked_set.contains(key_str.as_str()) {
                        blocked_hashes.insert(*key_hash);
                    }
                }

                // 3. Reflect cluster blocked status back into local L1 shards
                tracker.apply_cluster_blocks(&blocked_hashes, &tracked_hashes);
            }
            pool.return_connection(conn);
        }
    }
}
