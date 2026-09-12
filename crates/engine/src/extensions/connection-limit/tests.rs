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
            "lease_ttl_secs": 30
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
            "lease_ttl_secs": 30
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

    let initial_pools = RedisPoolRegistry::global().pool_count();

    let bytes1 = serde_json::to_vec(&policy1).unwrap();
    let engine1 = ConnectionLimitEngine::from_snapshot(&bytes1).unwrap();

    let bytes2 = serde_json::to_vec(&policy2).unwrap();
    let engine2 = ConnectionLimitEngine::from_snapshot(&bytes2).unwrap();

    // Verify pool was reused because endpoint and settings matched!
    assert_eq!(RedisPoolRegistry::global().pool_count(), initial_pools + 1);

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
    let d_fallback = engine
        .acquire(host, path_tenant, ip1, |_| None)
        .unwrap();
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
