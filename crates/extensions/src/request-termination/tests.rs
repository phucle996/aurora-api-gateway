use super::engine::{RequestTerminationEngine, RequestTerminationEvalRequest};

#[test]
fn test_basic_termination_rule() {
    let json = r#"{
        "schema_version": 1,
        "generation": 42,
        "rules": [
            {
                "id": "global-term",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/v1/orders",
                "status_code": 503,
                "content_type": "application/json; charset=utf-8",
                "body": "{\"error\":\"Service temporarily unavailable\"}"
            }
        ]
    }"#;

    let engine =
        RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse clean snapshot");
    assert_eq!(engine.generation(), 42);
    assert_eq!(engine.rules_count(), 1);

    let req = RequestTerminationEvalRequest {
        host: b"api.example.com",
        path: b"/v1/orders",
        method: b"GET",
        headers: &[],
    };

    let decision = engine.evaluate(&req);
    assert!(decision.matched);
    assert!(decision.should_terminate);
    assert_eq!(decision.status_code, 503);
    assert_eq!(decision.content_type, "application/json; charset=utf-8");
    assert_eq!(
        decision.body,
        "{\"error\":\"Service temporarily unavailable\"}"
    );
}

#[test]
fn test_maintenance_mode_with_bypass_header() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "maintenance-rule",
                "priority": 1,
                "origin": "*",
                "path_prefix": "/",
                "status_code": 503,
                "content_type": "text/html; charset=utf-8",
                "body": "<h1>System Under Maintenance</h1>",
                "headers": [
                    { "name": "Retry-After", "value": "300" }
                ],
                "bypass_headers": [
                    { "name": "X-Maintenance-Bypass", "value": "secret123" }
                ]
            }
        ]
    }"#;

    let engine = RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse rule");

    // 1. Normal user without bypass header -> Terminated with 503
    let req_normal = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/checkout",
        method: b"POST",
        headers: &[(b"user-agent", b"curl/7.68.0")],
    };
    let d_normal = engine.evaluate(&req_normal);
    assert!(d_normal.matched);
    assert!(d_normal.should_terminate);
    assert_eq!(d_normal.status_code, 503);
    assert_eq!(d_normal.content_type, "text/html; charset=utf-8");
    assert_eq!(d_normal.headers.len(), 1);
    assert_eq!(d_normal.headers[0].0, "Retry-After");
    assert_eq!(d_normal.headers[0].1, "300");

    // 2. User with WRONG bypass header value -> Still terminated! (Strict key-value matching)
    let req_wrong_secret = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/checkout",
        method: b"POST",
        headers: &[(b"x-maintenance-bypass", b"wrong_secret")],
    };
    let d_wrong = engine.evaluate(&req_wrong_secret);
    assert!(d_wrong.matched);
    assert!(
        d_wrong.should_terminate,
        "Wrong secret must not bypass termination"
    );

    // 3. User with EMPTY bypass header value -> Still terminated! (No presence-only bypass)
    let req_empty_secret = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/checkout",
        method: b"POST",
        headers: &[(b"x-maintenance-bypass", b"")],
    };
    let d_empty = engine.evaluate(&req_empty_secret);
    assert!(d_empty.matched);
    assert!(
        d_empty.should_terminate,
        "Empty secret must not bypass termination"
    );

    // 4. Admin with valid secret -> Matched rule, but should_terminate is FALSE!
    let req_admin = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/checkout",
        method: b"POST",
        headers: &[(b"x-maintenance-bypass", b"secret123")],
    };
    let d_admin = engine.evaluate(&req_admin);
    assert!(d_admin.matched);
    assert!(
        !d_admin.should_terminate,
        "Admin with valid secret must bypass termination"
    );
}

#[test]
fn test_api_mocking_200_ok() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "mock-users",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api/mock/users",
                "methods": ["GET"],
                "status_code": 200,
                "content_type": "application/json",
                "body": "{\"users\":[{\"id\":1,\"name\":\"Alice\"}]}",
                "headers": [
                    { "name": "X-Mock-Engine", "value": "Aurora" }
                ]
            }
        ]
    }"#;

    let engine = RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse mock");

    let req = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/mock/users",
        method: b"GET",
        headers: &[],
    };

    let decision = engine.evaluate(&req);
    assert!(decision.matched);
    assert!(decision.should_terminate);
    assert_eq!(decision.status_code, 200);
    assert_eq!(decision.body, "{\"users\":[{\"id\":1,\"name\":\"Alice\"}]}");
}

#[test]
fn test_decommissioned_endpoint_410() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "legacy-api",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api/v0",
                "status_code": 410,
                "content_type": "application/json",
                "body": "{\"error\":\"API v0 has been permanently decommissioned\"}"
            }
        ]
    }"#;

    let engine = RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse legacy");

    let req = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v0/status",
        method: b"GET",
        headers: &[],
    };

    let decision = engine.evaluate(&req);
    assert!(decision.matched);
    assert!(decision.should_terminate);
    assert_eq!(decision.status_code, 410);
}

#[test]
fn test_method_and_path_filtering() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "block-writes",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api/readonly",
                "methods": ["POST", "DELETE", "PUT"],
                "status_code": 405,
                "body": "Method Not Allowed"
            }
        ]
    }"#;

    let engine = RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse methods");

    // GET passes through
    let req_get = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/readonly/items",
        method: b"GET",
        headers: &[],
    };
    assert!(!engine.evaluate(&req_get).matched);

    // POST is blocked
    let req_post = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/readonly/items",
        method: b"POST",
        headers: &[],
    };
    let d_post = engine.evaluate(&req_post);
    assert!(d_post.matched);
    assert_eq!(d_post.status_code, 405);
}

#[test]
fn test_rejects_invalid_status_code() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bad-status",
                "status_code": 650
            }
        ]
    }"#;

    assert!(RequestTerminationEngine::from_snapshot(json.as_bytes()).is_err());
}

#[test]
fn test_rejects_empty_rules() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": []
    }"#;

    assert!(RequestTerminationEngine::from_snapshot(json.as_bytes()).is_err());
}

#[test]
fn test_rejects_invalid_schema_version() {
    let json = r#"{
        "schema_version": 2,
        "generation": 1,
        "rules": [
            {
                "id": "rule-1"
            }
        ]
    }"#;

    assert!(RequestTerminationEngine::from_snapshot(json.as_bytes()).is_err());
}

#[test]
fn test_branchless_method_bitmask() {
    use super::engine::*;
    assert_eq!(method_to_mask(b"GET"), METHOD_GET);
    assert_eq!(method_to_mask(b"get"), METHOD_GET);
    assert_eq!(method_to_mask(b"GeT"), METHOD_GET);

    assert_eq!(method_to_mask(b"PUT"), METHOD_PUT);
    assert_eq!(method_to_mask(b"put"), METHOD_PUT);

    assert_eq!(method_to_mask(b"POST"), METHOD_POST);
    assert_eq!(method_to_mask(b"post"), METHOD_POST);
    assert_eq!(method_to_mask(b"pOsT"), METHOD_POST);

    assert_eq!(method_to_mask(b"HEAD"), METHOD_HEAD);
    assert_eq!(method_to_mask(b"head"), METHOD_HEAD);

    assert_eq!(method_to_mask(b"PATCH"), METHOD_PATCH);
    assert_eq!(method_to_mask(b"patch"), METHOD_PATCH);

    assert_eq!(method_to_mask(b"TRACE"), METHOD_TRACE);
    assert_eq!(method_to_mask(b"trace"), METHOD_TRACE);

    assert_eq!(method_to_mask(b"DELETE"), METHOD_DELETE);
    assert_eq!(method_to_mask(b"delete"), METHOD_DELETE);

    assert_eq!(method_to_mask(b"CONNECT"), METHOD_CONNECT);
    assert_eq!(method_to_mask(b"OPTIONS"), METHOD_OPTIONS);

    assert_eq!(method_to_mask(b"UNKNOWN"), METHOD_OTHER);
    assert_eq!(method_to_mask(b""), METHOD_OTHER);
}

#[test]
fn test_match_headers_trigger_termination() {
    let json = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "block-banned-device",
                "priority": 1,
                "origin": "*",
                "path_prefix": "/",
                "match_headers": [
                    { "name": "X-Client-Device", "value": "banned-device-123" }
                ],
                "status_code": 403,
                "content_type": "application/json",
                "body": "{\"error\":\"Device banned\"}",
                "bypass_headers": [
                    { "name": "X-Emergency-Allow", "value": "allow-secret-999" }
                ]
            }
        ]
    }"#;

    let engine =
        RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse match_headers rule");

    // 1. Valid device does not match trigger -> NOT terminated
    let req_clean = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v1/data",
        method: b"GET",
        headers: &[(b"x-client-device", b"valid-device-456")],
    };
    assert!(!engine.evaluate(&req_clean).matched);

    // 2. Request without header -> NOT terminated
    let req_no_header = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v1/data",
        method: b"GET",
        headers: &[],
    };
    assert!(!engine.evaluate(&req_no_header).matched);

    // 3. Banned device matches trigger -> Terminated with 403
    let req_banned = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v1/data",
        method: b"GET",
        headers: &[(b"x-client-device", b"banned-device-123")],
    };
    let d_banned = engine.evaluate(&req_banned);
    assert!(d_banned.matched);
    assert!(d_banned.should_terminate);
    assert_eq!(d_banned.status_code, 403);
    assert_eq!(d_banned.body, "{\"error\":\"Device banned\"}");

    // 4. Banned device with WRONG emergency bypass secret -> NOT bypassed, still terminated!
    let req_wrong_bypass = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v1/data",
        method: b"GET",
        headers: &[
            (b"x-client-device", b"banned-device-123"),
            (b"x-emergency-allow", b"wrong-token"),
        ],
    };
    let d_wrong_bypass = engine.evaluate(&req_wrong_bypass);
    assert!(d_wrong_bypass.matched);
    assert!(d_wrong_bypass.should_terminate);

    // 5. Banned device with valid emergency bypass -> Bypassed
    let req_bypassed = RequestTerminationEvalRequest {
        host: b"example.com",
        path: b"/api/v1/data",
        method: b"GET",
        headers: &[
            (b"x-client-device", b"banned-device-123"),
            (b"x-emergency-allow", b"allow-secret-999"),
        ],
    };
    let d_bypassed = engine.evaluate(&req_bypassed);
    assert!(d_bypassed.matched);
    assert!(!d_bypassed.should_terminate);
}
