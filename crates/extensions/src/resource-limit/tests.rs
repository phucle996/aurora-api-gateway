use super::config::ResourceLimitRequest;
use super::limiter::ResourceLimiter;

#[test]
fn test_resource_limit_header_exceeded_returns_431() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "limit-api",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api",
                "header_limit": 1024,
                "payload_limit": 1048576
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    // Header 2048 > 1024 limit -> 431
    let req = ResourceLimitRequest {
        origin: b"example.com",
        path: b"/api/users",
        header_bytes: 2048,
        payload_bytes: 512,
    };
    let decision = limiter.evaluate(&req);
    assert!(!decision.allowed);
    assert_eq!(decision.status_code, 431);
    assert_eq!(decision.rule_id, "limit-api");
    assert!(
        decision
            .response_body
            .starts_with(b"{\"error\":\"request_header_fields_too_large\"")
    );
}

#[test]
fn test_resource_limit_payload_exceeded_returns_413() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "limit-upload",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/upload",
                "header_limit": 8192,
                "payload_limit": 1048576
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    // Payload 2097152 (2MB) > 1048576 (1MB) -> 413
    let req = ResourceLimitRequest {
        origin: b"example.com",
        path: b"/upload/file",
        header_bytes: 512,
        payload_bytes: 2097152,
    };
    let decision = limiter.evaluate(&req);
    assert!(!decision.allowed);
    assert_eq!(decision.status_code, 413);
    assert_eq!(decision.rule_id, "limit-upload");
    assert!(
        decision
            .response_body
            .starts_with(b"{\"error\":\"payload_too_large\"")
    );
}

#[test]
fn test_resource_limit_both_within_bounds_allows() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "limit-ok",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/ok",
                "header_limit": 8192,
                "payload_limit": 1048576
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    let req = ResourceLimitRequest {
        origin: b"example.com",
        path: b"/ok/check",
        header_bytes: 1024,
        payload_bytes: 512,
    };
    let decision = limiter.evaluate(&req);
    assert!(decision.allowed);
    assert_eq!(decision.status_code, 200);
}

#[test]
fn test_resource_limit_both_exceeded_prioritizes_header_431() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "limit-both",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "header_limit": 1024,
                "payload_limit": 1024
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    // Both violated -> Header check takes precedence (431)
    let req = ResourceLimitRequest {
        origin: b"example.com",
        path: b"/test",
        header_bytes: 2048,
        payload_bytes: 2048,
    };
    let decision = limiter.evaluate(&req);
    assert!(!decision.allowed);
    assert_eq!(decision.status_code, 431);
}

#[test]
fn test_resource_limit_path_and_host_matching() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "api-only",
                "priority": 10,
                "origin": "api.example.com",
                "path_prefix": "/api",
                "header_limit": 1024,
                "payload_limit": 1024
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    // Calling different origin -> Unconstrained -> Allow!
    let req_diff_origin = ResourceLimitRequest {
        origin: b"other.example.com",
        path: b"/api/test",
        header_bytes: 99999,
        payload_bytes: 99999,
    };
    assert!(limiter.evaluate(&req_diff_origin).allowed);

    // Calling different path -> Unconstrained -> Allow!
    let req_diff_path = ResourceLimitRequest {
        origin: b"api.example.com",
        path: b"/public/test",
        header_bytes: 99999,
        payload_bytes: 99999,
    };
    assert!(limiter.evaluate(&req_diff_path).allowed);

    // Matching origin and path but exceeding -> Deny!
    let req_match = ResourceLimitRequest {
        origin: b"api.example.com",
        path: b"/api/test",
        header_bytes: 2048,
        payload_bytes: 512,
    };
    assert!(!limiter.evaluate(&req_match).allowed);
}

#[test]
fn test_resource_limit_massive_u64_overflow_cannot_bypass_limits() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "limit-safe",
                "priority": 1,
                "origin": "*",
                "path_prefix": "/",
                "header_limit": 1024,
                "payload_limit": 2048
            }
        ]
    }"#;

    let limiter = ResourceLimiter::from_snapshot(raw).unwrap();

    // Passing u64::MAX (which wraps to -1 if treated as signed i64 without saturation)
    let req_overflow = ResourceLimitRequest {
        origin: b"example.com",
        path: b"/",
        header_bytes: u64::MAX,
        payload_bytes: u64::MAX,
    };
    let decision = limiter.evaluate(&req_overflow);
    assert!(
        !decision.allowed,
        "u64::MAX must NOT bypass resource limits!"
    );
    assert_eq!(decision.status_code, 431); // Header takes precedence
}
