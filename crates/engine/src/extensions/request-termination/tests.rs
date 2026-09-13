#[cfg(test)]
mod tests {
    use super::super::engine::{RequestTerminationEngine, RequestTerminationEvalRequest};

    #[test]
    fn test_flat_config_evaluation() {
        let json = r#"{
            "schema_version": 1,
            "generation": 42,
            "status_code": 503,
            "content_type": "application/json; charset=utf-8",
            "body": "{\"error\":\"Maintenance\"}"
        }"#;

        let engine =
            RequestTerminationEngine::from_snapshot(json.as_bytes()).expect("parse flat config");
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
        assert_eq!(decision.body, "{\"error\":\"Maintenance\"}");
    }

    #[test]
    fn test_maintenance_mode_with_bypass_header() {
        let json = r#"{
            "schema_version": 1,
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

        // 2. Admin with bypass header -> Matched rule, but should_terminate is FALSE!
        let req_admin = RequestTerminationEvalRequest {
            host: b"example.com",
            path: b"/checkout",
            method: b"POST",
            headers: &[(b"x-maintenance-bypass", b"secret123")],
        };
        let d_admin = engine.evaluate(&req_admin);
        assert!(d_admin.matched);
        assert!(!d_admin.should_terminate, "Admin with valid secret must bypass termination");
    }

    #[test]
    fn test_api_mocking_200_ok() {
        let json = r#"{
            "schema_version": 1,
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
            "status_code": 650
        }"#;

        assert!(RequestTerminationEngine::from_snapshot(json.as_bytes()).is_err());
    }
}
