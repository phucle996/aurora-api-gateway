use crate::extensions::rate_limit::types::ActionOnExceeded;
use crate::extensions::rate_limit::RateLimitEngine;
use crate::Error;

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
