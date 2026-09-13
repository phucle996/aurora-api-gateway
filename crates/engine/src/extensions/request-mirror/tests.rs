#[cfg(test)]
mod tests {
    use super::super::engine::{RequestMirrorEngine, RequestMirrorEvalRequest};

    #[test]
    fn test_flat_config_evaluation() {
        let json = r#"{
            "schema_version": 1,
            "generation": 42,
            "primary_upstream": "app_primary",
            "mirror_upstream": "app_shadow",
            "sample_percentage": 100,
            "ignore_mirror_errors": true
        }"#;

        let engine =
            RequestMirrorEngine::from_snapshot(json.as_bytes()).expect("parse flat config");
        assert_eq!(engine.generation(), 42);
        assert_eq!(engine.rules_count(), 1);

        let req = RequestMirrorEvalRequest {
            host: b"api.example.com",
            path: b"/v1/orders",
            method: b"GET",
            random_seed: 25,
        };

        let decision = engine.evaluate(&req);
        assert!(decision.matched);
        assert_eq!(decision.primary_upstream, "app_primary");
        assert_eq!(decision.mirror_upstream, "app_shadow");
        assert!(decision.is_mirrored);
    }

    #[test]
    fn test_method_filtering() {
        let json = r#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "get-only-mirror",
                    "priority": 1,
                    "origin": "*",
                    "path_prefix": "/api/read",
                    "methods": ["GET", "HEAD"],
                    "primary_upstream": "read_primary",
                    "mirror_upstream": "read_shadow",
                    "sample_percentage": 100
                }
            ]
        }"#;

        let engine =
            RequestMirrorEngine::from_snapshot(json.as_bytes()).expect("parse methods rule");

        // GET matches
        let get_req = RequestMirrorEvalRequest {
            host: b"example.com",
            path: b"/api/read/items",
            method: b"GET",
            random_seed: 0,
        };
        let d_get = engine.evaluate(&get_req);
        assert!(d_get.matched);
        assert_eq!(d_get.primary_upstream, "read_primary");
        assert_eq!(d_get.mirror_upstream, "read_shadow");
        assert!(d_get.is_mirrored);

        // POST does NOT match rule
        let post_req = RequestMirrorEvalRequest {
            host: b"example.com",
            path: b"/api/read/items",
            method: b"POST",
            random_seed: 0,
        };
        let d_post = engine.evaluate(&post_req);
        assert!(!d_post.matched);
    }

    #[test]
    fn test_sampling_rate() {
        let json = r#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "sampled-mirror",
                    "priority": 1,
                    "origin": "*",
                    "path_prefix": "/sample",
                    "primary_upstream": "main_up",
                    "mirror_upstream": "shadow_up",
                    "sample_percentage": 40
                }
            ]
        }"#;

        let engine =
            RequestMirrorEngine::from_snapshot(json.as_bytes()).expect("parse sample rule");

        // Seed 30 < 40 -> Mirrored
        let req_sampled = RequestMirrorEvalRequest {
            host: b"example.com",
            path: b"/sample/test",
            method: b"GET",
            random_seed: 30,
        };
        let d1 = engine.evaluate(&req_sampled);
        assert!(d1.matched);
        assert!(d1.is_mirrored);

        // Seed 45 >= 40 -> Not mirrored
        let req_skipped = RequestMirrorEvalRequest {
            host: b"example.com",
            path: b"/sample/test",
            method: b"GET",
            random_seed: 45,
        };
        let d2 = engine.evaluate(&req_skipped);
        assert!(d2.matched);
        assert!(!d2.is_mirrored);
        assert_eq!(d2.primary_upstream, "main_up");
    }

    #[test]
    fn test_custom_mirror_headers() {
        let json = r#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "header-mirror",
                    "priority": 1,
                    "origin": "*",
                    "path_prefix": "/",
                    "primary_upstream": "p1",
                    "mirror_upstream": "m1",
                    "sample_percentage": 100,
                    "mirror_headers": [
                        { "name": "X-Shadow", "value": "true" },
                        { "name": "X-Track", "value": "shadow-test" }
                    ]
                }
            ]
        }"#;

        let engine = RequestMirrorEngine::from_snapshot(json.as_bytes()).expect("parse headers");
        let req = RequestMirrorEvalRequest {
            host: b"example.com",
            path: b"/data",
            method: b"GET",
            random_seed: 0,
        };

        let decision = engine.evaluate(&req);
        assert!(decision.matched);
        assert_eq!(decision.mirror_headers.len(), 3);
        assert_eq!(decision.mirror_headers[0].0, "X-Shadow");
        assert_eq!(decision.mirror_headers[0].1, "true");
        assert_eq!(decision.mirror_headers[1].0, "X-Track");
        assert_eq!(decision.mirror_headers[1].1, "shadow-test");
        assert_eq!(decision.mirror_headers[2].0, "x-request-mirror");
        assert_eq!(decision.mirror_headers[2].1, "true");
    }

    #[test]
    fn test_rejects_identical_primary_and_mirror() {
        let json = r#"{
            "schema_version": 1,
            "primary_upstream": "same_backend",
            "mirror_upstream": "same_backend"
        }"#;

        assert!(RequestMirrorEngine::from_snapshot(json.as_bytes()).is_err());
    }
}
