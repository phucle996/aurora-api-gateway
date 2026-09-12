use super::engine::TrafficShaperEngine;
use super::types::TrafficShaperDecision;

#[test]
fn test_traffic_shaper_basic_client_ip_match() {
    let json = r#"{
        "schema_version": 1,
        "generation": 42,
        "rules": [
            {
                "id": "rule-global",
                "priority": 100,
                "host": "*",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "rate_kb_per_sec": 1024,
                "burst_kb": 2048
            }
        ]
    }"#;

    let engine = TrafficShaperEngine::from_snapshot(json.as_bytes()).unwrap();
    assert_eq!(engine.generation(), 42);
    assert_eq!(engine.rules_count(), 1);

    let decision = engine.evaluate(b"example.com", b"/index.html", b"1.2.3.4", |_| None);
    assert!(decision.matched);
    assert_eq!(decision.rule_id, "rule-global");
    assert_eq!(decision.rate_bytes_per_sec, 1024 * 1024);
    assert_eq!(decision.burst_bytes, 2048 * 1024);
}

#[test]
fn test_traffic_shaper_header_tiering_fallback() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "rule-vip",
                "priority": 10,
                "host": "*",
                "path_prefix": "/download",
                "limit_by": "header",
                "header_name": "x-tier",
                "rate_kb_per_sec": 10240,
                "burst_kb": 20480
            },
            {
                "id": "rule-free",
                "priority": 20,
                "host": "*",
                "path_prefix": "/download",
                "limit_by": "client_ip",
                "rate_kb_per_sec": 512,
                "burst_kb": 1024
            }
        ]
    }"#;

    let engine = TrafficShaperEngine::from_snapshot(json.as_bytes()).unwrap();

    // 1. Request with x-tier: vip -> matches rule-vip
    let d_vip = engine.evaluate(b"example.com", b"/download/file.zip", b"1.2.3.4", |h| {
        if h == "x-tier" {
            Some(b"vip")
        } else {
            None
        }
    });
    assert!(d_vip.matched);
    assert_eq!(d_vip.rule_id, "rule-vip");
    assert_eq!(d_vip.rate_bytes_per_sec, 10240 * 1024);

    // 2. Request without x-tier header -> falls through to rule-free
    let d_free = engine.evaluate(b"example.com", b"/download/file.zip", b"1.2.3.4", |_| None);
    assert!(d_free.matched);
    assert_eq!(d_free.rule_id, "rule-free");
    assert_eq!(d_free.rate_bytes_per_sec, 512 * 1024);

    // 3. Request on different path -> passthrough (no match)
    let d_other = engine.evaluate(b"example.com", b"/api/users", b"1.2.3.4", |_| None);
    assert_eq!(d_other, TrafficShaperDecision::passthrough());
}

#[test]
fn test_traffic_shaper_route_path_match() {
    let json = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "rule-path",
                "priority": 1,
                "host": "api.example.com",
                "path_prefix": "/stream",
                "limit_by": "route_path",
                "rate_kb_per_sec": 2048,
                "burst_kb": 0
            }
        ]
    }"#;

    let engine = TrafficShaperEngine::from_snapshot(json.as_bytes()).unwrap();

    let d_match = engine.evaluate(b"api.example.com", b"/stream/live", b"127.0.0.1", |_| None);
    assert!(d_match.matched);
    assert_eq!(d_match.rule_id, "rule-path");
    assert_eq!(d_match.rate_bytes_per_sec, 2048 * 1024);
    assert_eq!(d_match.burst_bytes, 0);

    // Host mismatch
    let d_bad_host = engine.evaluate(b"other.com", b"/stream/live", b"127.0.0.1", |_| None);
    assert!(!d_bad_host.matched);
}

#[test]
fn test_traffic_shaper_invalid_snapshot_rejected() {
    // 0 rate
    let bad_rate = r#"{"rules":[{"id":"r1","rate_kb_per_sec":0}]}"#;
    assert!(TrafficShaperEngine::from_snapshot(bad_rate.as_bytes()).is_err());

    // header limit_by missing header_name
    let missing_hdr = r#"{"rules":[{"id":"r1","limit_by":"header","rate_kb_per_sec":100}]}"#;
    assert!(TrafficShaperEngine::from_snapshot(missing_hdr.as_bytes()).is_err());

    // invalid limit_by
    let invalid_limit = r#"{"rules":[{"id":"r1","limit_by":"unknown","rate_kb_per_sec":100}]}"#;
    assert!(TrafficShaperEngine::from_snapshot(invalid_limit.as_bytes()).is_err());
}
