use super::engine::RequestSizeLimitEngine;
use super::types::RequestSizeEvalRequest;

#[test]
fn test_request_size_limit_snapshot_parsing() {
    let valid_json = br#"{
        "schema_version": 1,
        "generation": 10,
        "rules": [
            {
                "id": "rule-1",
                "priority": 1,
                "origin": "*",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 1048576,
                "max_header_bytes": 16384,
                "max_body_bytes": 1048576,
                "rejected_code": 413,
                "response_body": "{\"error\":\"too_big\"}"
            }
        ]
    }"#;
    let engine = RequestSizeLimitEngine::from_snapshot(valid_json).expect("valid snapshot");
    assert_eq!(engine.generation(), 10);
    assert_eq!(engine.rules_count(), 1);

    // Invalid schema version
    let bad_version = br#"{"schema_version": 2, "rules": []}"#;
    assert!(RequestSizeLimitEngine::from_snapshot(bad_version).is_err());

    // Invalid regex
    let bad_regex = br#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "bad-re",
                "max_request_bytes": 1000,
                "match_value": "[a-z"
            }
        ]
    }"#;
    assert!(RequestSizeLimitEngine::from_snapshot(bad_regex).is_err());

    // Duplicate ID
    let dup_id = br#"{
        "schema_version": 1,
        "rules": [
            { "id": "dup", "max_request_bytes": 1000 },
            { "id": "dup", "max_request_bytes": 2000 }
        ]
    }"#;
    assert!(RequestSizeLimitEngine::from_snapshot(dup_id).is_err());
}

#[test]
fn test_total_request_size_and_header_bombing_protection() {
    let json = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "total-and-header-guard",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 10000,
                "max_header_bytes": 2000,
                "max_body_bytes": 9000,
                "rejected_code": 413,
                "response_body": "{\"error\":\"oversized\"}"
            }
        ]
    }"#;
    let engine = RequestSizeLimitEngine::from_snapshot(json).unwrap();

    let no_header_lookup = |_: &str| -> Option<&[u8]> { None };

    // 1. Normal request under limits: 500 byte header + 4000 byte body = 4500 < 10000
    let normal_req = RequestSizeEvalRequest {
        origin: b"api.example.com",
        path: b"/api/v1/data",
        client_ip: b"127.0.0.1",
        header_bytes: 500,
        body_bytes: 4000,
    };
    let d1 = engine.evaluate(&normal_req, no_header_lookup);
    assert!(d1.allowed);
    assert!(d1.matched);
    assert_eq!(d1.rule_id, "total-and-header-guard");

    // 2. Header bombing attack: header alone is 2500 > 2000
    let header_bomb = RequestSizeEvalRequest {
        origin: b"api.example.com",
        path: b"/api/v1/data",
        client_ip: b"127.0.0.1",
        header_bytes: 2500,
        body_bytes: 0,
    };
    let d2 = engine.evaluate(&header_bomb, no_header_lookup);
    assert!(!d2.allowed);
    assert_eq!(d2.rejected_code, 413);
    assert_eq!(d2.response_body, b"{\"error\":\"oversized\"}");

    // 3. Body overflow: body alone is 9500 > 9000
    let body_overflow = RequestSizeEvalRequest {
        origin: b"api.example.com",
        path: b"/api/v1/data",
        client_ip: b"127.0.0.1",
        header_bytes: 500,
        body_bytes: 9500,
    };
    let d3 = engine.evaluate(&body_overflow, no_header_lookup);
    assert!(!d3.allowed);
    assert_eq!(d3.rejected_code, 413);

    // 4. Combined total overflow: 1800 byte header + 8500 byte body = 10300 > 10000
    let total_overflow = RequestSizeEvalRequest {
        origin: b"api.example.com",
        path: b"/api/v1/data",
        client_ip: b"127.0.0.1",
        header_bytes: 1800,
        body_bytes: 8500,
    };
    let d4 = engine.evaluate(&total_overflow, no_header_lookup);
    assert!(!d4.allowed);
    assert_eq!(d4.rejected_code, 413);
}

#[test]
fn test_limit_by_header_regex_matching() {
    let json = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "vip-upload",
                "priority": 1,
                "origin": "*",
                "path_prefix": "/upload",
                "limit_by": "header",
                "header_name": "x-role",
                "match_value": "^(admin|vip)$",
                "max_request_bytes": 50000000,
                "max_header_bytes": 65536,
                "max_body_bytes": 50000000
            },
            {
                "id": "standard-upload",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/upload",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 1000000,
                "max_header_bytes": 16384,
                "max_body_bytes": 1000000,
                "rejected_code": 413,
                "response_body": "{\"error\":\"standard_quota_exceeded\"}"
            }
        ]
    }"#;
    let engine = RequestSizeLimitEngine::from_snapshot(json).unwrap();

    let vip_header_lookup = |name: &str| -> Option<&[u8]> {
        if name == "x-role" {
            Some(b"vip")
        } else {
            None
        }
    };

    let user_header_lookup = |name: &str| -> Option<&[u8]> {
        if name == "x-role" {
            Some(b"regular-user")
        } else {
            None
        }
    };

    // 5MB upload request
    let large_upload = RequestSizeEvalRequest {
        origin: b"upload.example.com",
        path: b"/upload/file.zip",
        client_ip: b"1.2.3.4",
        header_bytes: 500,
        body_bytes: 5_000_000,
    };

    // VIP matches vip-upload (50MB limit) -> Allowed!
    let d_vip = engine.evaluate(&large_upload, vip_header_lookup);
    assert!(d_vip.allowed);
    assert_eq!(d_vip.rule_id, "vip-upload");

    // Regular user doesn't match vip-upload regex -> falls through to standard-upload (1MB limit) -> Rejected!
    let d_user = engine.evaluate(&large_upload, user_header_lookup);
    assert!(!d_user.allowed);
    assert_eq!(d_user.rule_id, "standard-upload");
    assert_eq!(d_user.response_body, b"{\"error\":\"standard_quota_exceeded\"}");
}

#[test]
fn test_origin_scoping_and_wildcards() {
    let json = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "exact-origin",
                "priority": 10,
                "origin": "api.domain.com",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 500
            },
            {
                "id": "subdomain-origin",
                "priority": 20,
                "origin": "*.domain.com",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 2000
            },
            {
                "id": "global-origin",
                "priority": 30,
                "origin": "*",
                "path_prefix": "/",
                "limit_by": "client_ip",
                "match_value": "*",
                "max_request_bytes": 10000
            }
        ]
    }"#;
    let engine = RequestSizeLimitEngine::from_snapshot(json).unwrap();
    let no_lookup = |_: &str| -> Option<&[u8]> { None };

    let req_exact = RequestSizeEvalRequest {
        origin: b"api.domain.com",
        path: b"/test",
        client_ip: b"127.0.0.1",
        header_bytes: 100,
        body_bytes: 600, // 700 > 500
    };
    let d_exact = engine.evaluate(&req_exact, no_lookup);
    assert!(!d_exact.allowed);
    assert_eq!(d_exact.rule_id, "exact-origin");

    let req_sub = RequestSizeEvalRequest {
        origin: b"static.domain.com",
        path: b"/test",
        client_ip: b"127.0.0.1",
        header_bytes: 100,
        body_bytes: 600, // 700 < 2000
    };
    let d_sub = engine.evaluate(&req_sub, no_lookup);
    assert!(d_sub.allowed);
    assert_eq!(d_sub.rule_id, "subdomain-origin");

    let req_other = RequestSizeEvalRequest {
        origin: b"other.org",
        path: b"/test",
        client_ip: b"127.0.0.1",
        header_bytes: 100,
        body_bytes: 600, // 700 < 10000
    };
    let d_other = engine.evaluate(&req_other, no_lookup);
    assert!(d_other.allowed);
    assert_eq!(d_other.rule_id, "global-origin");
}
