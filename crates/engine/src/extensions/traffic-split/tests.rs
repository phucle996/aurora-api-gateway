use super::engine::TrafficSplitEngine;
use super::types::TrafficSplitEvalRequest;
use crate::Error;

#[test]
fn test_valid_80_20_split_policy() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "canary-v2",
                "priority": 10,
                "origin": "api.example.com",
                "path_prefix": "/v2",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "backend_v1", "weight": 80 },
                    { "upstream": "backend_v2", "weight": 20 }
                ]
            }
        ]
    }"#;

    let engine = TrafficSplitEngine::from_snapshot(json.as_bytes()).expect("Valid policy");
    assert_eq!(engine.generation(), 1);
    assert_eq!(engine.rules_count(), 1);

    // Test sticky routing for same client IP
    let req1 = TrafficSplitEvalRequest {
        origin: b"api.example.com",
        path: b"/v2/users",
        client_ip: b"192.168.1.100",
        random_seed: 0,
    };
    let d1 = engine.evaluate(&req1, |_| None);
    assert!(d1.matched);
    assert_eq!(d1.rule_id, "canary-v2");

    let req2 = TrafficSplitEvalRequest {
        origin: b"api.example.com",
        path: b"/v2/items",
        client_ip: b"192.168.1.100",
        random_seed: 99,
    };
    let d2 = engine.evaluate(&req2, |_| None);
    assert_eq!(d1.upstream, d2.upstream, "Client IP must be deterministic and sticky");

    // Path prefix / origin mismatch
    let req_diff_path = TrafficSplitEvalRequest {
        origin: b"api.example.com",
        path: b"/v1/users",
        client_ip: b"192.168.1.100",
        random_seed: 0,
    };
    assert!(!engine.evaluate(&req_diff_path, |_| None).matched);

    let req_diff_origin = TrafficSplitEvalRequest {
        origin: b"other.example.com",
        path: b"/v2/users",
        client_ip: b"192.168.1.100",
        random_seed: 0,
    };
    assert!(!engine.evaluate(&req_diff_origin, |_| None).matched);
}

#[test]
fn test_weight_distribution_approximation() {
    let json = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "split-80-20",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "main_cluster", "weight": 80 },
                    { "upstream": "canary_cluster", "weight": 20 }
                ]
            }
        ]
    }"#;
    let engine = TrafficSplitEngine::from_snapshot(json.as_bytes()).expect("Valid policy");

    let mut main_count = 0;
    let mut canary_count = 0;
    let total = 10_000;

    for i in 0..total {
        let ip_str = format!("10.{}.{}.{}", (i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF);
        let req = TrafficSplitEvalRequest {
            origin: b"example.com",
            path: b"/",
            client_ip: ip_str.as_bytes(),
            random_seed: 0,
        };
        let d = engine.evaluate(&req, |_| None);
        if d.upstream == "main_cluster" {
            main_count += 1;
        } else if d.upstream == "canary_cluster" {
            canary_count += 1;
        }
    }

    let main_pct = (main_count as f64 / total as f64) * 100.0;
    let canary_pct = (canary_count as f64 / total as f64) * 100.0;

    // FNV1a hash across 10,000 distinct IPs should fall comfortably within 77%..83% and 17%..23%
    assert!(
        (76.0..=84.0).contains(&main_pct),
        "Expected ~80% for main_cluster, got {:.2}%",
        main_pct
    );
    assert!(
        (16.0..=24.0).contains(&canary_pct),
        "Expected ~20% for canary_cluster, got {:.2}%",
        canary_pct
    );
}

#[test]
fn test_invariants_rejected() {
    // 1. Weight sum != 100 (sum is 90)
    let bad_sum_90 = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "u1", "weight": 50 },
                    { "upstream": "u2", "weight": 40 }
                ]
            }
        ]
    }"#;
    assert_eq!(
        TrafficSplitEngine::from_snapshot(bad_sum_90.as_bytes()).unwrap_err(),
        Error::InvalidPolicy
    );

    // 2. Weight sum != 100 (sum is 105)
    let bad_sum_105 = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "u1", "weight": 60 },
                    { "upstream": "u2", "weight": 45 }
                ]
            }
        ]
    }"#;
    assert_eq!(
        TrafficSplitEngine::from_snapshot(bad_sum_105.as_bytes()).unwrap_err(),
        Error::InvalidPolicy
    );

    // 3. Less than 2 targets (only 1 target with 100 weight)
    let single_target = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "u1", "weight": 100 }
                ]
            }
        ]
    }"#;
    assert_eq!(
        TrafficSplitEngine::from_snapshot(single_target.as_bytes()).unwrap_err(),
        Error::InvalidPolicy
    );

    // 4. Duplicate upstream target within a rule
    let dup_target = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "u1", "weight": 50 },
                    { "upstream": "u1", "weight": 50 }
                ]
            }
        ]
    }"#;
    assert_eq!(
        TrafficSplitEngine::from_snapshot(dup_target.as_bytes()).unwrap_err(),
        Error::InvalidPolicy
    );

    // 5. Weight 0
    let zero_weight = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "client_ip",
                "splits": [
                    { "upstream": "u1", "weight": 100 },
                    { "upstream": "u2", "weight": 0 }
                ]
            }
        ]
    }"#;
    assert_eq!(
        TrafficSplitEngine::from_snapshot(zero_weight.as_bytes()).unwrap_err(),
        Error::InvalidPolicy
    );
}

#[test]
fn test_split_by_header() {
    let json = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "header-split",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api/users",
                "split_by": "header",
                "header_name": "x-user-id",
                "splits": [
                    { "upstream": "users_prod", "weight": 50 },
                    { "upstream": "users_canary", "weight": 50 }
                ]
            }
        ]
    }"#;

    let engine = TrafficSplitEngine::from_snapshot(json.as_bytes()).expect("Valid policy");

    // Header matching
    let req_header = TrafficSplitEvalRequest {
        origin: b"example.com",
        path: b"/api/users/profile",
        client_ip: b"127.0.0.1",
        random_seed: 0,
    };
    let d_hdr = engine.evaluate(&req_header, |h| {
        if h == "x-user-id" {
            Some(b"usr_987654")
        } else {
            None
        }
    });
    assert!(d_hdr.matched);
    assert_eq!(d_hdr.rule_id, "header-split");
    assert!(d_hdr.upstream == "users_prod" || d_hdr.upstream == "users_canary");

    // Fallback to client_ip if header absent
    let d_missing = engine.evaluate(&req_header, |_| None);
    assert!(d_missing.matched);
    assert_eq!(d_missing.rule_id, "header-split");
}

#[test]
fn test_split_by_random() {
    let json = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "rand-split",
                "origin": "*",
                "path_prefix": "/",
                "split_by": "random",
                "splits": [
                    { "upstream": "cluster_a", "weight": 50 },
                    { "upstream": "cluster_b", "weight": 50 }
                ]
            }
        ]
    }"#;
    let engine = TrafficSplitEngine::from_snapshot(json.as_bytes()).expect("Valid policy");

    let req_low = TrafficSplitEvalRequest {
        origin: b"example.com",
        path: b"/",
        client_ip: b"10.0.0.1",
        random_seed: 20, // 20 < 50 -> cluster_a
    };
    assert_eq!(engine.evaluate(&req_low, |_| None).upstream, "cluster_a");

    let req_high = TrafficSplitEvalRequest {
        origin: b"example.com",
        path: b"/",
        client_ip: b"10.0.0.1",
        random_seed: 80, // 80 >= 50 -> cluster_b
    };
    assert_eq!(engine.evaluate(&req_high, |_| None).upstream, "cluster_b");
}
