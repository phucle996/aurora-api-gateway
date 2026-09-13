use crate::Error;
use crate::extensions::rate_limit::RateLimitEngine;
use crate::extensions::rate_limit::types::ActionOnExceeded;

#[test]
fn borrowed_counter_keys_preserve_hash_and_rule_identity() {
    use super::shard::RateLimitKeyRef;
    use hashbrown::Equivalent;
    use std::hash::BuildHasher;

    let hasher = std::collections::hash_map::RandomState::new();
    for idx in 0..64 {
        for bytes in [b"".as_slice(), b"client-a", b"client-a\0", &[255; 16384]] {
            let owned = (idx, bytes.to_vec());
            let query = RateLimitKeyRef(idx, bytes);
            assert_eq!(hasher.hash_one(&query), hasher.hash_one(&owned));
            assert!(query.equivalent(&owned));
            assert!(!query.equivalent(&(idx + 1, bytes.to_vec())));
        }
    }
}

#[test]
fn ttl_bound_preserves_expiry_with_mixed_periods_and_clock_rollback() {
    use super::shard::{RateLimitKeyRef, Shard, ShardConfig, insert_shard_entry};
    use super::types::{
        CompiledRule, EvictionPolicy, LimitBy, OverflowStrategy, RateLimitAlgorithm,
    };

    let mut rule = CompiledRule {
        id: "ttl".into(),
        host: b"*".to_vec(),
        path_prefix: b"/".to_vec(),
        limit_by: LimitBy::ClientIp,
        header_name: None,
        rate: 1,
        period_secs: 60,
        burst: 1,
        action_on_exceeded: ActionOnExceeded::Throttle,
        rejected_code: 429,
        custom_message: None,
        response_headers: Vec::new(),
    };
    let cfg = ShardConfig {
        max_keys_per_shard: 2,
        eviction_policy: EvictionPolicy::Lru,
        overflow_strategy: OverflowStrategy::DropNew,
        algorithm: RateLimitAlgorithm::TokenBucket,
    };
    let mut shard = Shard::new();
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(0, b"old"),
        &rule,
        &cfg,
        100,
        100_000,
    )
    .unwrap();
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(0, b"recent"),
        &rule,
        &cfg,
        200,
        200_000,
    )
    .unwrap();
    assert!(
        insert_shard_entry(
            &mut shard,
            &RateLimitKeyRef(0, b"full"),
            &rule,
            &cfg,
            210,
            210_000
        )
        .is_err()
    );
    // The incoming rule's TTL threshold remains authoritative, including equality.
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(0, b"new"),
        &rule,
        &cfg,
        220,
        220_000,
    )
    .unwrap();
    assert!(!shard.entries.contains_key(&RateLimitKeyRef(0, b"old")));
    assert!(shard.entries.contains_key(&RateLimitKeyRef(0, b"recent")));
    assert_eq!(shard.oldest_access_lower_bound, 200);

    // A shorter incoming period must trigger a sweep even at the same time.
    rule.period_secs = 5;
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(1, b"short"),
        &rule,
        &cfg,
        220,
        220_000,
    )
    .unwrap();
    assert!(!shard.entries.contains_key(&RateLimitKeyRef(0, b"recent")));
    assert!(shard.entries.contains_key(&RateLimitKeyRef(0, b"new")));

    // Insert after clock rollback; its older timestamp must lower the bound.
    shard.entries.remove(&RateLimitKeyRef(1, b"short"));
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(1, b"rollback"),
        &rule,
        &cfg,
        50,
        50_000,
    )
    .unwrap();
    assert_eq!(shard.oldest_access_lower_bound, 50);
    insert_shard_entry(
        &mut shard,
        &RateLimitKeyRef(1, b"recovered"),
        &rule,
        &cfg,
        61,
        61_000,
    )
    .unwrap();
    assert!(!shard.entries.contains_key(&RateLimitKeyRef(1, b"rollback")));
    assert!(shard.entries.contains_key(&RateLimitKeyRef(0, b"new")));
}

#[test]
fn full_shard_preserves_each_eviction_policy() {
    use super::shard::{RateLimitKeyRef, Shard, ShardConfig, insert_shard_entry};
    use super::types::{
        CompiledRule, EvictionPolicy, LimitBy, OverflowStrategy, RateLimitAlgorithm,
    };

    let rule = CompiledRule {
        id: "eviction".into(),
        host: b"*".to_vec(),
        path_prefix: b"/".to_vec(),
        limit_by: LimitBy::ClientIp,
        header_name: None,
        rate: 1,
        period_secs: 1000,
        burst: 1,
        action_on_exceeded: ActionOnExceeded::Throttle,
        rejected_code: 429,
        custom_message: None,
        response_headers: Vec::new(),
    };
    for (policy, victim) in [
        (EvictionPolicy::Lru, b"b"),
        (EvictionPolicy::Lfu, b"c"),
        (EvictionPolicy::Fifo, b"a"),
    ] {
        let cfg = ShardConfig {
            max_keys_per_shard: 3,
            eviction_policy: policy,
            overflow_strategy: OverflowStrategy::EvictAndTrack,
            algorithm: RateLimitAlgorithm::TokenBucket,
        };
        let mut shard = Shard::new();
        for (key, created, accessed, count) in [
            (b"a", 100, 400, 10),
            (b"b", 200, 200, 5),
            (b"c", 300, 300, 1),
        ] {
            let entry = insert_shard_entry(
                &mut shard,
                &RateLimitKeyRef(0, key),
                &rule,
                &cfg,
                created,
                created * 1000,
            )
            .unwrap();
            entry.last_access_secs = accessed;
            entry.access_count = count;
        }
        insert_shard_entry(
            &mut shard,
            &RateLimitKeyRef(0, b"d"),
            &rule,
            &cfg,
            500,
            500_000,
        )
        .unwrap();
        assert_eq!(shard.entries.len(), 3);
        assert!(
            !shard.entries.contains_key(&RateLimitKeyRef(0, victim)),
            "{policy:?}"
        );
        assert!(shard.entries.contains_key(&RateLimitKeyRef(0, b"d")));
    }
}

#[test]
fn existing_counter_survives_full_shard_and_borrowed_input_reuse() {
    use super::shard::hash_key;

    for algorithm in [
        "token_bucket",
        "leaky_bucket",
        "fixed_window",
        "sliding_window",
    ] {
        for overflow in ["drop_new", "bypass_new", "evict_and_track"] {
            let mut policy = sample_snapshot(vec![serde_json::json!({
                "id": "counter", "host": "*", "path_prefix": "/api",
                "limit_by": "header", "header_name": "x-api-key",
                "rate": 2, "burst": 2, "period_secs": 86400,
                "action_on_exceeded": "throttle"
            })]);
            policy["algorithm"] = algorithm.into();
            policy["max_keys"] = 16.into(); // One counter per shard.
            policy["overflow_strategy"] = overflow.into();
            let engine =
                RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy).unwrap()).unwrap();
            let mut buffer = b"client-original".to_vec();
            assert!(
                engine
                    .evaluate(b"example.com", b"/api", b"127.0.0.1", |_| Some(&buffer))
                    .unwrap()
                    .allowed
            );
            // Simulate the adapter reusing its request buffer after evaluate.
            buffer.fill(b'x');
            let original = b"client-original";
            let decision = engine
                .evaluate(b"example.com", b"/api", b"127.0.0.1", |_| Some(original))
                .unwrap();
            assert!(decision.allowed, "{algorithm}/{overflow}");
            assert_eq!(decision.remaining, 0);
            assert!(
                !engine
                    .evaluate(b"example.com", b"/api", b"127.0.0.1", |_| Some(original))
                    .unwrap()
                    .allowed
            );

            let new_key = (0..1000)
                .map(|i| format!("new-{i}"))
                .find(|key| hash_key(0, key.as_bytes()) == hash_key(0, original))
                .unwrap();
            let decision = engine
                .evaluate(b"example.com", b"/api", b"127.0.0.1", |_| {
                    Some(new_key.as_bytes())
                })
                .unwrap();
            assert_eq!(decision.allowed, overflow != "drop_new");
            let old = engine
                .evaluate(b"example.com", b"/api", b"127.0.0.1", |_| Some(original))
                .unwrap();
            assert_eq!(
                old.allowed,
                overflow == "evict_and_track",
                "{algorithm}/{overflow}"
            );
        }
    }
}

#[test]
fn local_counters_keep_rule_and_identifier_quotas_independent() {
    let policy = sample_snapshot(vec![
        serde_json::json!({"id":"a", "host":"*", "path_prefix":"/a", "limit_by":"header", "header_name":"x-api-key", "rate":1, "period_secs":86400, "action_on_exceeded":"throttle"}),
        serde_json::json!({"id":"b", "host":"*", "path_prefix":"/b", "limit_by":"header", "header_name":"x-api-key", "rate":1, "period_secs":86400, "action_on_exceeded":"throttle"}),
    ]);
    let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy).unwrap()).unwrap();
    for key in [b"client-a".as_slice(), b"client-b"] {
        for path in [b"/a".as_slice(), b"/b"] {
            assert!(
                engine
                    .evaluate(b"example.com", path, b"127.0.0.1", |_| Some(key))
                    .unwrap()
                    .allowed
            );
            assert!(
                !engine
                    .evaluate(b"example.com", path, b"127.0.0.1", |_| Some(key))
                    .unwrap()
                    .allowed
            );
        }
    }
}

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
    let d1 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);

    // 2nd request -> allow
    let d2 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d2.allowed);

    // 3rd request -> allow (burst = 3)
    let d3 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d3.allowed);

    // 4th request -> throttle (burst exceeded)
    let d4 = engine.evaluate(host, path, ip, |_| None).unwrap();
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
        "limit_by": "header",
        "header_name": "x-api-key",
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
    let key_val: &[u8] = b"sec-key-123";

    let lookup = |name: &str| -> Option<&[u8]> {
        if name == "x-api-key" {
            Some(key_val)
        } else {
            None
        }
    };

    let d1 = engine.evaluate(host, path, ip, lookup).unwrap();
    assert!(d1.allowed);

    let d2 = engine.evaluate(host, path, ip, lookup).unwrap();
    assert!(d2.allowed);

    let d3 = engine.evaluate(host, path, ip, lookup).unwrap();
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

    let d1 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);

    let d2 = engine.evaluate(host, path, ip, |_| None).unwrap();
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
        let _ = engine.evaluate(b"example.com", b"/test", ip.as_bytes(), |_| None);
    }

    let mut had_dropped = false;
    for i in 100..200 {
        let ip = format!("192.168.{}.{}", i / 256, i % 256);
        let d = engine
            .evaluate(b"example.com", b"/test", ip.as_bytes(), |_| None)
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
    let d1 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);

    // 2nd request -> allowed (water = 2.0)
    let d2 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d2.allowed);

    // 3rd request -> allowed (water = 3.0 = capacity)
    let d3 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d3.allowed);

    // 4th request -> throttle (water 4.0 > capacity 3.0)
    let d4 = engine.evaluate(host, path, ip, |_| None).unwrap();
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

    let d1 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d1.allowed);

    let d2 = engine.evaluate(host, path, ip, |_| None).unwrap();
    assert!(d2.allowed);

    let d3 = engine.evaluate(host, path, ip, |_| None).unwrap();
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
            "limit_by": "header",
            "header_name": "x-api-key",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        }),
        serde_json::json!({
            "id": "auth_rule",
            "host": "*",
            "path_prefix": "/secure",
            "limit_by": "header",
            "header_name": "authorization",
            "rate": 10,
            "period_secs": 1,
            "action_on_exceeded": "throttle"
        }),
    ]);

    let engine = RateLimitEngine::from_snapshot(&serde_json::to_vec(&policy_json).unwrap())
        .expect("load engine");

    // Missing client_ip must fail with InvalidRequest, not fallback to 127.0.0.1
    let err_ip = engine.evaluate(b"example.com", b"/api/test", b"", |name: &str| {
        if name == "x-api-key" {
            Some(b"key-1" as &[u8])
        } else {
            None
        }
    });
    assert!(matches!(err_ip, Err(Error::InvalidRequest)));

    // Missing header on header rule must fail with InvalidRequest, not fallback to anonymous
    let err_key = engine.evaluate(b"example.com", b"/api/test", b"1.2.3.4", |_| None);
    assert!(matches!(err_key, Err(Error::InvalidRequest)));

    let err_empty_key = engine.evaluate(b"example.com", b"/api/test", b"1.2.3.4", |name: &str| {
        if name == "x-api-key" {
            Some(b"" as &[u8])
        } else {
            None
        }
    });
    assert!(matches!(err_empty_key, Err(Error::InvalidRequest)));

    // Missing authorization header must fail with InvalidRequest, not fallback to anonymous
    let err_auth = engine.evaluate(b"example.com", b"/secure/data", b"1.2.3.4", |_| None);
    assert!(matches!(err_auth, Err(Error::InvalidRequest)));
}

#[test]
fn test_distributed_mode_fallback_local_on_error() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "algorithm": "token_bucket",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "redis": {
            "endpoint": "redis://127.0.0.1:59999",
            "timeout_ms": 5,
            "on_error": "fallback_local",
            "reconnect_interval_secs": 1
        },
        "rules": [
            {
                "id": "dist-rule-fallback",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "rate": 2,
                "period_secs": 10,
                "burst": 2,
                "action_on_exceeded": "throttle"
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).unwrap();

    // Redis port 59999 is down, so on_error = "fallback_local" must use local in-memory shards:
    let r1 = engine
        .evaluate(b"example.com", b"/api/v1", b"10.0.0.1", |_| None)
        .unwrap();
    assert!(r1.allowed);
    assert_eq!(r1.remaining, 1);

    let r2 = engine
        .evaluate(b"example.com", b"/api/v1", b"10.0.0.1", |_| None)
        .unwrap();
    assert!(r2.allowed);
    assert_eq!(r2.remaining, 0);

    let r3 = engine
        .evaluate(b"example.com", b"/api/v1", b"10.0.0.1", |_| None)
        .unwrap();
    assert!(!r3.allowed);
    assert_eq!(r3.status_code, 429);
}

#[test]
fn test_distributed_mode_pass_on_error() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "algorithm": "token_bucket",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "redis": {
            "endpoint": "redis://127.0.0.1:59999",
            "timeout_ms": 5,
            "on_error": "pass",
            "reconnect_interval_secs": 1
        },
        "rules": [
            {
                "id": "dist-rule-pass",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "rate": 1,
                "period_secs": 10,
                "burst": 1,
                "action_on_exceeded": "throttle"
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).unwrap();

    // Redis is down, on_error = "pass" allows all requests through (Fail-Open):
    for _ in 0..5 {
        let r = engine
            .evaluate(b"example.com", b"/api/v1", b"10.0.0.2", |_| None)
            .unwrap();
        assert!(r.allowed);
        assert_eq!(r.status_code, 200);
    }
}

#[test]
fn test_distributed_mode_block_on_error() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "algorithm": "token_bucket",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "redis": {
            "endpoint": "redis://127.0.0.1:59999",
            "timeout_ms": 5,
            "on_error": "block",
            "reconnect_interval_secs": 1
        },
        "rules": [
            {
                "id": "dist-rule-block",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "rate": 100,
                "period_secs": 10,
                "burst": 100,
                "action_on_exceeded": "throttle"
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).unwrap();

    // Redis is down, on_error = "block" rejects requests immediately (Fail-Closed):
    let r = engine
        .evaluate(b"example.com", b"/api/v1", b"10.0.0.3", |_| None)
        .unwrap();
    assert!(!r.allowed);
    assert_eq!(r.status_code, 429);
}

#[test]
fn test_distributed_mode_custom_lua_and_pool_size() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "algorithm": "token_bucket",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "redis": {
            "endpoint": "redis://127.0.0.1:59999",
            "timeout_ms": 5,
            "pool_size": 16,
            "on_error": "fallback_local",
            "custom_lua_script": "return { 1, 999, 0, 0 }"
        },
        "rules": [
            {
                "id": "dist-custom-lua",
                "host": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "rate": 10,
                "period_secs": 10,
                "action_on_exceeded": "throttle"
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).expect("engine with custom lua and pool_size");
    assert_eq!(engine.generation(), 1);
}

#[test]
fn test_distributed_mode_tls_options() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "distributed",
        "algorithm": "sliding_window",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "redis": {
            "endpoint": "redis://127.0.0.1:6379",
            "timeout_ms": 10,
            "pool_size": 4,
            "on_error": "pass",
            "tls": {
                "enabled": true,
                "insecure_skip_verify": true
            }
        },
        "rules": [
            {
                "id": "dist-tls",
                "host": "*",
                "path_prefix": "/secure",
                "limit_by": "client_ip",
                "rate": 10,
                "period_secs": 10,
                "action_on_exceeded": "throttle"
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).expect("engine with tls and sliding window");
    assert_eq!(engine.generation(), 1);
}

#[test]
fn test_distributed_mode_algorithms_dispatch() {
    for algo in &[
        "token_bucket",
        "leaky_bucket",
        "fixed_window",
        "sliding_window",
    ] {
        let json = format!(
            r#"{{
            "schema_version": 1,
            "generation": 1,
            "mode": "distributed",
            "algorithm": "{}",
            "memory_size_mb": 16,
            "max_keys": 1000,
            "eviction_policy": "lru",
            "overflow_strategy": "evict_and_track",
            "redis": {{
                "endpoint": "redis://127.0.0.1:59999",
                "timeout_ms": 5,
                "pool_size": 2,
                "on_error": "pass"
            }},
            "rules": [
                {{
                    "id": "dist-algo-{}",
                    "host": "*",
                    "path_prefix": "/test",
                    "limit_by": "client_ip",
                    "rate": 10,
                    "period_secs": 10,
                    "action_on_exceeded": "throttle"
                }}
            ]
        }}"#,
            algo, algo
        );

        let engine =
            RateLimitEngine::from_snapshot(json.as_bytes()).expect("engine initialization");
        assert_eq!(engine.generation(), 1);
    }
}

#[test]
fn test_custom_message_and_headers_interpolation() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "mode": "local",
        "algorithm": "fixed_window",
        "memory_size_mb": 16,
        "max_keys": 1000,
        "eviction_policy": "lru",
        "overflow_strategy": "evict_and_track",
        "rules": [
            {
                "id": "rule-custom-response",
                "host": "*",
                "path_prefix": "/api/v1",
                "limit_by": "client_ip",
                "rate": 1,
                "period_secs": 60,
                "action_on_exceeded": "throttle",
                "rejected_code": 429,
                "custom_message": "{\"error\":\"rate_limited\",\"retry_in\":$retry_after,\"remaining\":$remaining,\"limit\":$limit}",
                "response_headers": [
                    { "name": "Retry-After", "value": "$retry_after" },
                    { "name": "X-RateLimit-Limit", "value": "$limit" },
                    { "name": "X-RateLimit-Remaining", "value": "$remaining" },
                    { "name": "Content-Type", "value": "application/json" }
                ]
            }
        ]
    }"#;

    let engine = RateLimitEngine::from_snapshot(raw).expect("create engine");
    let ip = b"192.168.1.100";

    // Request 1: allowed
    let r1 = engine
        .evaluate(b"api.example.com", b"/api/v1/users", ip, |_| None)
        .unwrap();
    assert!(r1.allowed);
    assert_eq!(r1.remaining, 0);

    // Request 2: throttled, custom response and headers rendered
    let r2 = engine
        .evaluate(b"api.example.com", b"/api/v1/users", ip, |_| None)
        .unwrap();
    assert!(!r2.allowed);
    assert_eq!(r2.status_code, 429);
    assert!(r2.retry_after_secs >= 1);

    // Check custom headers
    assert_eq!(r2.headers.len(), 4);
    assert_eq!(r2.headers[0].name, "Retry-After");
    assert_eq!(r2.headers[0].value, r2.retry_after_secs.to_string());
    assert_eq!(r2.headers[1].name, "X-RateLimit-Limit");
    assert_eq!(r2.headers[1].value, "1");
    assert_eq!(r2.headers[2].name, "X-RateLimit-Remaining");
    assert_eq!(r2.headers[2].value, "0");
    assert_eq!(r2.headers[3].name, "Content-Type");
    assert_eq!(r2.headers[3].value, "application/json");

    // Check custom body
    let body_str = String::from_utf8(r2.body.expect("body exists")).unwrap();
    let expected_body = format!(
        "{{\"error\":\"rate_limited\",\"retry_in\":{},\"remaining\":0,\"limit\":1}}",
        r2.retry_after_secs
    );
    assert_eq!(body_str, expected_body);
}
