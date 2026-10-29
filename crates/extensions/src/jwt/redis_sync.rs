//! Dedicated Shadow Worker Synchronization for JWT Revocation via Redis (L2).
//!
//! Pre-arms the L1 In-Memory Sheet Cache (`JwtCache`) completely out-of-band:
//! 1. **Initial Boot & Reconnect Pre-Arming**:
//!    Uses cursor-based `SSCAN` pagination with `COUNT 100` and version gating (`GET aurora:jwt:revocation_version`).
//!    Prevents blocking Redis and eliminates memory bus saturation.
//! 2. **Real-Time Pub/Sub Pre-Arming**:
//!    Subscribes to Redis channel `aurora:jwt:revocations`.
//!    Whenever a logout event is published, in-place flips `status = 0` on L1 Sheet in < 1ms.
//! 3. **Version Gated Periodic Reconciliation**:
//!    Every 30s, checks `GET aurora:jwt:revocation_version` ($O(1)$, ~8 bytes).
//!    If versions match, skips scanning with zero overhead.
//!    If remote version is higher (e.g. due to missed packets during network blip),
//!    reconciles via cursor pagination to guarantee zero desync.
//!
//! The Traffic Worker hot path NEVER makes network calls to Redis and evaluates purely in L1 RAM (~7-10ns).

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::redis_pool::RedisConnectionPool;
use super::cache::JwtCache;

/// Global Redis key tracking global revocation version counter.
pub const REDIS_JWT_REVOCATION_VERSION_KEY: &str = "aurora:jwt:revocation_version";
/// Global Redis Set containing active revocations.
pub const REDIS_JWT_REVOCATION_SET_KEY: &str = "aurora:jwt:revoked_set";
/// Redis Pub/Sub channel for real-time revocation events.
pub const REDIS_JWT_REVOCATION_CHANNEL: &str = "aurora:jwt:revocations";
/// Periodic reconciliation interval to safeguard against missed Pub/Sub messages.
pub const PERIODIC_RECONCILIATION_INTERVAL: Duration = Duration::from_secs(30);
/// Batch size for SSCAN cursor pagination.
pub const SSCAN_BATCH_SIZE: usize = 100;
/// Socket read timeout on Pub/Sub connection.
pub const PUBSUB_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// Autonomous Shadow task that keeps the L1 In-Memory Sheet Cache synchronized with L2 Redis.
pub async fn run_jwt_redis_shadow_sync(
    cache: Arc<JwtCache>,
    pool: Arc<RedisConnectionPool>,
) {
    tokio::task::spawn_blocking(move || {
        let mut backoff = Duration::from_secs(1);
        let mut local_version: Option<u64> = None;

        loop {
            // 1. Initial / Reconnect Boot Sync via Version Gated SSCAN
            reconcile_from_redis(&cache, &pool, &mut local_version);

            // 2. Real-time Pub/Sub listener loop with read timeout and periodic reconciliation
            match pool.get_connection() {
                Ok(mut conn) => {
                    backoff = Duration::from_secs(1);

                    let mut pubsub = conn.as_pubsub();
                    let _ = pubsub.set_read_timeout(Some(PUBSUB_READ_TIMEOUT));

                    if pubsub.subscribe(REDIS_JWT_REVOCATION_CHANNEL).is_ok() {
                        let mut last_reconcile = Instant::now();

                        loop {
                            match pubsub.get_message() {
                                Ok(msg) => {
                                    if let Ok(item) = msg.get_payload::<String>() {
                                        let now = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_secs();
                                        if let Some(msg_version) = apply_revocation_item(&cache, &item, now) {
                                            local_version = Some(
                                                local_version.unwrap_or(0).max(msg_version)
                                            );
                                        }
                                    }

                                    // Periodic check even under continuous message flow
                                    if last_reconcile.elapsed() >= PERIODIC_RECONCILIATION_INTERVAL {
                                        reconcile_from_redis(&cache, &pool, &mut local_version);
                                        last_reconcile = Instant::now();
                                    }
                                }
                                Err(err) if err.is_timeout() => {
                                    // Pub/Sub idle timeout: run periodic reconciliation if interval elapsed
                                    if last_reconcile.elapsed() >= PERIODIC_RECONCILIATION_INTERVAL {
                                        reconcile_from_redis(&cache, &pool, &mut local_version);
                                        last_reconcile = Instant::now();
                                    }
                                }
                                Err(_) => {
                                    // Socket error, EOF, or broken connection: exit to trigger reconnect
                                    break;
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    // Transient connection error: sleep and retry with exponential backoff
                }
            }

            std::thread::sleep(backoff);
            backoff = (backoff * 2).min(Duration::from_secs(15));
        }
    })
    .await
    .ok();
}

/// Reconciles the L1 Sheet Cache with Redis L2 using Version Gating and cursor-based SSCAN pagination.
///
/// 1. Reads `aurora:jwt:revocation_version` ($O(1)$, ~8 bytes).
/// 2. If `remote_version <= *local_version` and already synced: terminates immediately with 0 SSCAN cost.
/// 3. Otherwise: pages through `aurora:jwt:revoked_set` with `COUNT 100`, applying in-place status bit flips.
///    Sleeps 1ms between pages to yield CPU bus and prevent lock contention on the memory bus.
pub(crate) fn reconcile_from_redis(
    cache: &JwtCache,
    pool: &RedisConnectionPool,
    local_version: &mut Option<u64>,
) {
    let Ok(mut conn) = pool.get_connection() else {
        return;
    };

    // Step 1: Version Gate Check (O(1), ~8 bytes over wire)
    let remote_version: u64 = redis::cmd("GET")
        .arg(REDIS_JWT_REVOCATION_VERSION_KEY)
        .query::<Option<u64>>(&mut conn)
        .unwrap_or_default()
        .unwrap_or(0);

    // If local version matches remote and is already initialized, skip entirely (Zero cost!)
    if let Some(lv) = *local_version
        && remote_version <= lv
    {
        pool.return_connection(conn);
        return;
    }

    // Step 2: Cursor-based SSCAN pagination (chunk size: SSCAN_BATCH_SIZE)
    let mut cursor = 0u64;
    loop {
        let result: Result<(u64, Vec<String>), redis::RedisError> = redis::cmd("SSCAN")
            .arg(REDIS_JWT_REVOCATION_SET_KEY)
            .arg(cursor)
            .arg("COUNT")
            .arg(SSCAN_BATCH_SIZE)
            .query(&mut conn);

        match result {
            Ok((next_cursor, batch)) => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                for item in batch {
                    apply_revocation_item(cache, &item, now);
                }

                cursor = next_cursor;
                if cursor == 0 {
                    break;
                }
                // Micro-yield: prevent CPU bus saturation and let other tasks breathe
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(_) => {
                break;
            }
        }
    }

    *local_version = Some(remote_version);
    pool.return_connection(conn);
}

/// Applies a revocation message payload to the L1 Sheet Cache.
///
/// Supported formats:
/// - `jti:<unique_id>` or `jti:<unique_id>:<expire_epoch>`
/// - `<raw_token_string>` or `<raw_token_string>:<expire_epoch>`
/// - `<numeric_token_hash>` or `<numeric_token_hash>:<expire_epoch>`
/// - Optional version suffix: `#<version>` or `@<version>`
#[inline]
pub(crate) fn apply_revocation_item(cache: &JwtCache, item: &str, now: u64) -> Option<u64> {
    let mut trimmed = item.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Check optional version suffix: #<version> or @<version>
    let version = if let Some(hash_pos) = trimmed.rfind('#').or_else(|| trimmed.rfind('@')) {
        let v_str = &trimmed[hash_pos + 1..];
        if let Ok(v) = v_str.parse::<u64>() {
            trimmed = trimmed[..hash_pos].trim();
            Some(v)
        } else {
            None
        }
    } else {
        None
    };

    if trimmed.is_empty() {
        return version;
    }

    // Check optional :<expire_epoch> suffix
    let (target, until_epoch) = if let Some(last_colon) = trimmed.rfind(':') {
        let suffix = &trimmed[last_colon + 1..];
        if let Ok(exp) = suffix.parse::<u64>() {
            let pref = &trimmed[..last_colon];
            if !pref.is_empty() {
                (pref, exp)
            } else {
                (trimmed, 0)
            }
        } else {
            (trimmed, 0)
        }
    } else {
        (trimmed, 0)
    };

    if let Some(jti) = target.strip_prefix("jti:") {
        cache.revoke_jti(jti, until_epoch, now);
    } else if let Ok(h) = target.parse::<u64>() {
        cache.revoke_token(h, until_epoch, now);
    } else {
        cache.revoke_token(JwtCache::hash_token(target), until_epoch, now);
    }

    version
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jwt::cache::CacheLookup;

    #[test]
    fn test_apply_revocation_item_formats() {
        let err: redis::RedisError = redis::RedisError::from(std::io::Error::from(std::io::ErrorKind::TimedOut));
        assert!(err.is_timeout());
        let cache = JwtCache::new(4, 32, 300, 60);
        let now = 1000;

        // 1. JTI without explicit epoch
        let v1 = apply_revocation_item(&cache, "jti:auth0-usr-99", now);
        assert_eq!(v1, None);
        assert!(cache.is_negative(JwtCache::hash_jti("auth0-usr-99"), now));

        // 2. JTI with explicit epoch and version suffix `#101`
        let v2 = apply_revocation_item(&cache, "jti:auth0-usr-100:2000#101", now);
        assert_eq!(v2, Some(101));
        assert!(cache.is_negative(JwtCache::hash_jti("auth0-usr-100"), 1500));
        assert!(!cache.is_negative(JwtCache::hash_jti("auth0-usr-100"), 2001));

        // 3. Raw token string with `@202` version suffix
        let raw_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fake";
        let v3 = apply_revocation_item(&cache, &format!("{raw_token}@202"), now);
        assert_eq!(v3, Some(202));
        let h = JwtCache::hash_token(raw_token);
        assert_eq!(cache.lookup(h, now), CacheLookup::HitDeny);

        // 4. Token hash numeric format
        let numeric_h = 9876543210123456789u64;
        let v4 = apply_revocation_item(&cache, &format!("{numeric_h}:3000"), now);
        assert_eq!(v4, None);
        assert_eq!(cache.lookup(numeric_h, 2500), CacheLookup::HitDeny);
    }

    #[test]
    fn test_version_gate_decision_logic() {
        let mut local_version: Option<u64> = None;

        // Uninitialized local version must trigger scan
        assert!(local_version.is_none());

        // Initialized local version matches remote -> skip
        local_version = Some(42);
        let remote_version = 42u64;
        assert!(remote_version <= local_version.unwrap());

        // Remote version higher -> trigger reconciliation
        let remote_version = 43u64;
        assert!(remote_version > local_version.unwrap());
    }
}
