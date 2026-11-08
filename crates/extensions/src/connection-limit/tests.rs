use super::engine::ConnectionLimitEngine;
use crate::redis_pool::RedisPoolRegistry;
use serde_json::json;

#[test]
fn test_local_connection_limit_acquire_and_release() {
    let policy = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            {
                "id": "rule-local-1",
                "priority": 1,
                "host": "api.example.com",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "max_connections": 2,
                "action_on_exceeded": "throttle",
                "rejected_code": 503
            }
        ]
    });

    let bytes = serde_json::to_vec(&policy).unwrap();
    let engine = ConnectionLimitEngine::from_snapshot(&bytes).unwrap();

    let host = b"api.example.com";
    let path = b"/api/v1/resource";
    let ip = b"192.168.1.100";

    // Request 1: Should succeed
    let d1 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);
    assert_eq!(d1.current_connections, 1);
    let token1 = d1.token.expect("expected token for request 1");

    // Request 2: Should succeed
    let d2 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d2.allowed);
    assert_eq!(d2.current_connections, 2);
    let token2 = d2.token.expect("expected token for request 2");

    // Request 3: Exceeds max_connections (2) -> Should be rejected
    let d3 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(!d3.allowed);
    assert_eq!(d3.status_code, 503);
    assert!(d3.token.is_none());

    // Release Request 1
    engine.release(&token1);

    // Request 4 (retry): Now should succeed because 1 slot was freed
    let d4 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d4.allowed);
    assert_eq!(d4.current_connections, 2);
    let token4 = d4.token.expect("expected token for request 4");

    // Release remaining
    engine.release(&token2);
    engine.release(&token4);

    // Release again to test saturation at 0 (should not panic or underflow)
    engine.release(&token1);
}

#[test]
fn test_custom_response_headers_and_body_interpolation() {
    let policy = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            {
                "id": "rule-custom-resp",
                "priority": 1,
                "host": "*",
                "path_prefix": "/download",
                "limit_by": "client_ip",
                "max_connections": 1,
                "action_on_exceeded": "custom_response",
                "rejected_code": 429,
                "response_headers": [
                    { "name": "Content-Type", "value": "application/json" },
                    { "name": "X-ConnLimit-Max", "value": "$limit" },
                    { "name": "X-ConnLimit-Rule", "value": "$rule_id" }
                ],
                "response_body": "{\"error\":\"too_many_connections\",\"current\":$current_connections,\"limit\":$limit,\"rule\":\"$rule_id\"}"
            }
        ]
    });

    let bytes = serde_json::to_vec(&policy).unwrap();
    let engine = ConnectionLimitEngine::from_snapshot(&bytes).unwrap();

    let host = b"example.com";
    let path = b"/download/file.zip";
    let ip = b"10.0.0.1";

    let d1 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);
    let token1 = d1.token.unwrap();

    let d2 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(!d2.allowed);
    assert_eq!(d2.status_code, 429);

    // Check custom headers
    let limit_hdr = d2
        .headers
        .iter()
        .find(|h| h.name == "X-ConnLimit-Max")
        .unwrap();
    assert_eq!(limit_hdr.value, "1");
    let rule_hdr = d2
        .headers
        .iter()
        .find(|h| h.name == "X-ConnLimit-Rule")
        .unwrap();
    assert_eq!(rule_hdr.value, "rule-custom-resp");

    // Check custom body
    let body_str = String::from_utf8(d2.body.unwrap()).unwrap();
    assert!(body_str.contains("\"error\":\"too_many_connections\""));
    assert!(body_str.contains("\"current\":1"));
    assert!(body_str.contains("\"limit\":1"));
    assert!(body_str.contains("\"rule\":\"rule-custom-resp\""));

    engine.release(&token1);
}

#[test]
fn test_distributed_mode_failover_and_pool_reuse() {
    let policy1 = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "redis": {
            "endpoint": "redis://127.0.0.1:19999",
            "timeout_ms": 20,
            "pool_size": 4,
            "on_error": "fallback_local",
            "lease_ttl_secs": 30,
            "sync_interval_ms": 0
        },
        "rules": [
            {
                "id": "rule-dist-1",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "max_connections": 2,
                "action_on_exceeded": "throttle"
            }
        ]
    });

    let policy2 = json!({
        "schema_version": 1,
        "generation": 2,
        "mode": "distributed",
        "redis": {
            "endpoint": "redis://127.0.0.1:19999", // same endpoint -> pool reuse!
            "timeout_ms": 20,
            "pool_size": 4,
            "on_error": "pass",
            "lease_ttl_secs": 30,
            "sync_interval_ms": 0
        },
        "rules": [
            {
                "id": "rule-dist-2",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "max_connections": 2,
                "action_on_exceeded": "throttle"
            }
        ]
    });

    let bytes1 = serde_json::to_vec(&policy1).unwrap();
    let engine1 = ConnectionLimitEngine::from_snapshot(&bytes1).unwrap();

    let bytes2 = serde_json::to_vec(&policy2).unwrap();
    let engine2 = ConnectionLimitEngine::from_snapshot(&bytes2).unwrap();

    // Verify pool was reused because endpoint and settings matched!
    let key = crate::redis_pool::RedisPoolKey {
        endpoint: "redis://127.0.0.1:19999".to_string(),
        db: None,
        username: None,
        password: None,
        tls_enabled: false,
        insecure_skip_verify: false,
        ca_cert: None,
        client_cert: None,
        client_key: None,
    };
    let p1 = RedisPoolRegistry::global()
        .get_or_create(key.clone(), std::time::Duration::from_millis(20), 4)
        .unwrap();
    let p2 = RedisPoolRegistry::global()
        .get_or_create(key, std::time::Duration::from_millis(20), 4)
        .unwrap();
    assert!(std::sync::Arc::ptr_eq(&p1, &p2));

    let host = b"example.com";
    let path = b"/api/test";
    let ip = b"1.2.3.4";

    // Engine 1 uses fallback_local on Redis error
    let d1 = engine1.acquire(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);
    let token1 = d1.token.unwrap();

    let d2 = engine1.acquire(host, path, ip, |_| None).unwrap();
    assert!(d2.allowed);
    let token2 = d2.token.unwrap();

    let d3 = engine1.acquire(host, path, ip, |_| None).unwrap();
    assert!(!d3.allowed);

    engine1.release(&token1);
    engine1.release(&token2);

    // Engine 2 uses pass on Redis error
    let d_pass = engine2.acquire(host, path, ip, |_| None).unwrap();
    assert!(d_pass.allowed);
}

#[test]
fn test_header_and_route_path_connection_limiting() {
    let policy = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            {
                "id": "rule-header-tenant",
                "priority": 1,
                "host": "*",
                "path_prefix": "/tenant",
                "limit_by": "header",
                "header_name": "x-tenant-id",
                "max_connections": 1,
                "action_on_exceeded": "throttle",
                "rejected_code": 429
            },
            {
                "id": "rule-route-path",
                "priority": 2,
                "host": "*",
                "path_prefix": "/shared-path",
                "limit_by": "route_path",
                "max_connections": 1,
                "action_on_exceeded": "throttle",
                "rejected_code": 503
            }
        ]
    });

    let bytes = serde_json::to_vec(&policy).unwrap();
    let engine = ConnectionLimitEngine::from_snapshot(&bytes).unwrap();

    let host = b"api.example.com";
    let path_tenant = b"/tenant/orders";
    let ip1 = b"10.0.0.1";
    let ip2 = b"10.0.0.2";

    // Tenant Alpha request 1
    let d_alpha1 = engine
        .acquire(host, path_tenant, ip1, |name| {
            if name == "x-tenant-id" {
                Some(b"tenant-alpha")
            } else {
                None
            }
        })
        .unwrap();
    assert!(d_alpha1.allowed);
    let tok_alpha1 = d_alpha1.token.unwrap();

    // Tenant Alpha request 2 from DIFFERENT IP -> should be blocked because max_connections is 1 per tenant
    let d_alpha2 = engine
        .acquire(host, path_tenant, ip2, |name| {
            if name == "x-tenant-id" {
                Some(b"tenant-alpha")
            } else {
                None
            }
        })
        .unwrap();
    assert!(!d_alpha2.allowed);
    assert_eq!(d_alpha2.status_code, 429);

    // Tenant Beta request 1 -> should succeed (different header value)
    let d_beta1 = engine
        .acquire(host, path_tenant, ip1, |name| {
            if name == "x-tenant-id" {
                Some(b"tenant-beta")
            } else {
                None
            }
        })
        .unwrap();
    assert!(d_beta1.allowed);
    let tok_beta1 = d_beta1.token.unwrap();

    // Request missing x-tenant-id header -> falls back to client_ip
    let d_fallback = engine.acquire(host, path_tenant, ip1, |_| None).unwrap();
    assert!(d_fallback.allowed);
    let tok_fallback = d_fallback.token.unwrap();

    // Route path rule test
    let path_shared = b"/shared-path/report";
    let d_path1 = engine.acquire(host, path_shared, ip1, |_| None).unwrap();
    assert!(d_path1.allowed);
    let tok_path1 = d_path1.token.unwrap();

    // Second request to same path from different IP -> blocked (limit_by route_path)
    let d_path2 = engine.acquire(host, path_shared, ip2, |_| None).unwrap();
    assert!(!d_path2.allowed);
    assert_eq!(d_path2.status_code, 503);

    engine.release(&tok_alpha1);
    engine.release(&tok_beta1);
    engine.release(&tok_fallback);
    engine.release(&tok_path1);
}

#[test]
fn test_policy_validation() {
    use super::materialize::materialize;
    use super::policy::ConnectionLimitPolicy;

    // Valid policy
    let valid_json = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            {
                "id": "rule-1",
                "host": "example.com",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "max_connections": 10
            }
        ]
    });
    let policy: ConnectionLimitPolicy = serde_json::from_value(valid_json.clone()).unwrap();
    assert!(policy.validate().is_ok());

    let mut slots = Vec::new();
    assert!(materialize(&valid_json, &mut slots).is_ok());
    assert_eq!(slots.len(), 1);
    assert_eq!(slots[0].0, aurora_engine::shm::AURORA_EXT_CONN_LIMIT);

    // Invalid schema version
    let mut invalid = valid_json.clone();
    invalid["schema_version"] = json!(2);
    let policy: ConnectionLimitPolicy = serde_json::from_value(invalid).unwrap();
    assert!(policy.validate().is_err());

    // Invalid relative path
    let mut invalid_path = valid_json.clone();
    invalid_path["rules"][0]["path_prefix"] = json!("../etc/passwd");
    let policy: ConnectionLimitPolicy = serde_json::from_value(invalid_path).unwrap();
    assert!(policy.validate().is_err());

    // Duplicate rule id
    let duplicate_id = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            { "id": "dup", "path_prefix": "/a", "max_connections": 5 },
            { "id": "dup", "path_prefix": "/b", "max_connections": 5 }
        ]
    });
    let policy: ConnectionLimitPolicy = serde_json::from_value(duplicate_id).unwrap();
    assert!(policy.validate().is_err());
}

#[test]
fn test_sharded_conn_tracker_zero_alloc_hash() {
    use super::tracker::ShardedConnTracker;

    let tracker = ShardedConnTracker::new();
    let rule_id = b"test-rule";
    let identifier = b"192.168.1.10";

    let hash1 = ShardedConnTracker::hash_key(rule_id, identifier);
    let hash2 = ShardedConnTracker::hash_key(rule_id, identifier);
    assert_eq!(hash1, hash2);

    // Acquire up to limit 2
    let (ok1, cur1) = tracker.acquire_hash(hash1, 2);
    assert!(ok1);
    assert_eq!(cur1, 1);

    let (ok2, cur2) = tracker.acquire_hash(hash1, 2);
    assert!(ok2);
    assert_eq!(cur2, 2);

    // 3rd should be rejected
    let (ok3, cur3) = tracker.acquire_hash(hash1, 2);
    assert!(!ok3);
    assert_eq!(cur3, 2);

    // Release
    tracker.release_hash(hash1);
    let (ok4, cur4) = tracker.acquire_hash(hash1, 2);
    assert!(ok4);
    assert_eq!(cur4, 2);

    tracker.release_hash(hash1);
    tracker.release_hash(hash1);
}

#[test]
fn test_distributed_async_shadow_sync() {
    use rustc_hash::FxHashSet;

    let policy_json = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "redis": {
            "endpoint": "redis://127.0.0.1:6379",
            "timeout_ms": 50,
            "pool_size": 4,
            "on_error": "fallback_local",
            "lease_ttl_secs": 30,
            "sync_interval_ms": 500
        },
        "rules": [
            {
                "id": "async-rule-1",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "max_connections": 10,
                "action_on_exceeded": "throttle"
            }
        ]
    });

    let raw = serde_json::to_vec(&policy_json).unwrap();
    let engine = ConnectionLimitEngine::from_snapshot(&raw).unwrap();

    let host = b"example.com";
    let path = b"/api/v1/test";
    let ip = b"10.0.0.99";

    // Request is admitted directly in RAM (fast L1 path)
    let d1 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);
    assert_eq!(d1.current_connections, 1);
    let token1 = d1.token.unwrap();
    assert!(!token1.is_redis); // L1 mode on hot-path: no blocking Redis release

    // Harvest sync entries collects active in-flight count
    let entries = engine.local_tracker.harvest_sync_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].1, "aurora:cl:cluster:async-rule-1:10.0.0.99");
    assert_eq!(entries[0].2, 1); // active_count

    // Simulate cluster-wide limit exceeded received from Redis
    let key_hash = entries[0].0;
    let mut blocked = FxHashSet::default();
    blocked.insert(key_hash);
    engine
        .local_tracker
        .apply_cluster_blocks(&blocked, &[key_hash]);

    // Next request from this client is rejected immediately in L1 RAM
    let d2 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(!d2.allowed);
    assert_eq!(d2.status_code, 503);

    // Simulate cluster unblocked
    let empty_blocked = FxHashSet::default();
    engine
        .local_tracker
        .apply_cluster_blocks(&empty_blocked, &[key_hash]);

    // Request is allowed again
    let d3 = engine.acquire(host, path, ip, |_| None).unwrap();
    assert!(d3.allowed);

    engine.release(&token1);
}

#[test]
fn test_precomputed_hash_prefix_and_branchless_arithmetic() {
    use super::tracker::ShardedConnTracker;

    let rule_id = b"test-tenant-rate-limit-rule-xyz";
    let identifier = b"192.168.1.100";

    // 1. Verify precomputed prefix produces identical hash to full hash
    let prefix = ShardedConnTracker::precompute_rule_hash(rule_id);
    let streaming_hash = ShardedConnTracker::hash_with_prefix(prefix, identifier);
    let full_hash = ShardedConnTracker::hash_key(rule_id, identifier);
    assert_eq!(streaming_hash, full_hash);

    // 2. Verify packed 32-bit single-comparison branchless arithmetic
    let tracker = ShardedConnTracker::new();
    let max_conn = 2;

    // Normal acquire 1
    let (ok1, cur1) = tracker.acquire_hash(full_hash, max_conn);
    assert!(ok1);
    assert_eq!(cur1, 1);

    // Normal acquire 2
    let (ok2, cur2) = tracker.acquire_hash(full_hash, max_conn);
    assert!(ok2);
    assert_eq!(cur2, 2);

    // Normal reject 3 (local count >= max_conn)
    let (ok3, cur3) = tracker.acquire_hash(full_hash, max_conn);
    assert!(!ok3);
    assert_eq!(cur3, 2);

    // Release 1
    tracker.release_hash(full_hash);
    let (ok4, cur4) = tracker.acquire_hash(full_hash, max_conn);
    assert!(ok4);
    assert_eq!(cur4, 2);

    // Simulate cluster block via single bitwise OR
    let mut blocked_set = rustc_hash::FxHashSet::default();
    blocked_set.insert(full_hash);
    tracker.apply_cluster_blocks(&blocked_set, &[full_hash]);

    // Single comparison rejects immediately (< 5ns)
    let (ok_blocked, cur_blocked) = tracker.acquire_hash(full_hash, max_conn);
    assert!(!ok_blocked);
    assert_eq!(cur_blocked, 2);

    // Unblock
    let empty_set = rustc_hash::FxHashSet::default();
    tracker.apply_cluster_blocks(&empty_set, &[full_hash]);

    // Clean up
    tracker.release_hash(full_hash);
    tracker.release_hash(full_hash);
}

#[test]
fn test_pure_rule_branchless_bypass() {
    let policy_json = json!({
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "rules": [
            {
                "id": "pure-rule-1",
                "host": "*",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "max_connections": 10
            }
        ]
    });

    let raw = serde_json::to_vec(&policy_json).unwrap();
    let engine = ConnectionLimitEngine::from_snapshot(&raw).unwrap();

    // Verify pure rule matches any host and any path without string comparison
    let d1 = engine
        .acquire(b"any.host.com", b"/any/path", b"1.1.1.1", |_| None)
        .unwrap();
    assert!(d1.allowed);
    let token1 = d1.token.unwrap();
    assert_ne!(token1.key_hash, 0);

    engine.release(&token1);
}
