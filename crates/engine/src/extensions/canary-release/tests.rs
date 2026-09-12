use super::*;

fn eval_req<'a>(
    origin: &'a [u8],
    path: &'a [u8],
    uri: &'a [u8],
    query_string: &'a [u8],
    client_ip: &'a [u8],
    random_seed: u32,
) -> CanaryReleaseEvalRequest<'a> {
    CanaryReleaseEvalRequest {
        origin,
        path,
        uri,
        query_string,
        client_ip,
        random_seed,
    }
}

#[test]
fn test_canary_header_regex_match() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "canary-rule-1",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api",
                "baseline_upstream": "app_baseline",
                "canary_upstream": "app_canary",
                "match_conditions": [
                    { "target": "header", "key": "X-Canary", "regex": "^(true|beta)$" }
                ],
                "weight_percentage": 0,
                "canary_upstream_headers": [
                    { "name": "X-Routed-Canary", "value": "true" }
                ],
                "baseline_upstream_headers": [
                    { "name": "X-Routed-Canary", "value": "false" }
                ]
            }
        ]
    }"#;

    let engine = CanaryReleaseEngine::from_snapshot(policy.as_bytes()).unwrap();

    // 1. Header matches "true" -> Canary
    let req = eval_req(b"example.com", b"/api/users", b"/api/users", b"", b"127.0.0.1", 0);
    let decision = engine.evaluate(&req, |k| if k == "x-canary" { Some(b"true") } else { None });
    assert!(decision.matched);
    assert_eq!(decision.upstream, "app_canary");
    assert!(decision.is_canary);
    assert_eq!(decision.upstream_headers, vec![("X-Routed-Canary".to_string(), "true".to_string())]);

    // 2. Header matches "beta" -> Canary
    let decision2 = engine.evaluate(&req, |k| if k == "x-canary" { Some(b"beta") } else { None });
    assert_eq!(decision2.upstream, "app_canary");
    assert!(decision2.is_canary);

    // 3. Header does not match -> Baseline
    let decision3 = engine.evaluate(&req, |k| if k == "x-canary" { Some(b"false") } else { None });
    assert_eq!(decision3.upstream, "app_baseline");
    assert!(!decision3.is_canary);
    assert_eq!(decision3.upstream_headers, vec![("X-Routed-Canary".to_string(), "false".to_string())]);

    // 4. Header missing -> Baseline
    let decision4 = engine.evaluate(&req, |_| None);
    assert_eq!(decision4.upstream, "app_baseline");
    assert!(!decision4.is_canary);
}

#[test]
fn test_canary_uri_regex_match() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "canary-uri-rule",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "baseline_upstream": "legacy_v1",
                "canary_upstream": "nextgen_v2",
                "match_conditions": [
                    { "target": "uri", "regex": "^/v2/.*$" }
                ],
                "weight_percentage": 0,
                "canary_upstream_headers": [],
                "baseline_upstream_headers": []
            }
        ]
    }"#;

    let engine = CanaryReleaseEngine::from_snapshot(policy.as_bytes()).unwrap();

    let req_v2 = eval_req(b"example.com", b"/v2/products", b"/v2/products", b"", b"127.0.0.1", 0);
    let d1 = engine.evaluate(&req_v2, |_| None);
    assert_eq!(d1.upstream, "nextgen_v2");
    assert!(d1.is_canary);
    assert!(d1.upstream_headers.is_empty());

    let req_v1 = eval_req(b"example.com", b"/v1/products", b"/v1/products", b"", b"127.0.0.1", 0);
    let d2 = engine.evaluate(&req_v1, |_| None);
    assert_eq!(d2.upstream, "legacy_v1");
    assert!(!d2.is_canary);
}

#[test]
fn test_canary_query_regex_match() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "canary-query-rule",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/search",
                "baseline_upstream": "search_v1",
                "canary_upstream": "search_v2",
                "match_conditions": [
                    { "target": "query", "key": "exp", "regex": "^ai_search$" }
                ],
                "weight_percentage": 0,
                "canary_upstream_headers": [
                    { "name": "X-Search-Backend", "value": "ai-v2" }
                ],
                "baseline_upstream_headers": []
            }
        ]
    }"#;

    let engine = CanaryReleaseEngine::from_snapshot(policy.as_bytes()).unwrap();

    // Query contains exp=ai_search -> Canary
    let req_canary = eval_req(b"example.com", b"/search", b"/search?q=rust&exp=ai_search", b"q=rust&exp=ai_search", b"127.0.0.1", 0);
    let d1 = engine.evaluate(&req_canary, |_| None);
    assert_eq!(d1.upstream, "search_v2");
    assert!(d1.is_canary);
    assert_eq!(d1.upstream_headers, vec![("X-Search-Backend".to_string(), "ai-v2".to_string())]);

    // Query does not match -> Baseline
    let req_baseline = eval_req(b"example.com", b"/search", b"/search?q=rust&exp=standard", b"q=rust&exp=standard", b"127.0.0.1", 0);
    let d2 = engine.evaluate(&req_baseline, |_| None);
    assert_eq!(d2.upstream, "search_v1");
    assert!(!d2.is_canary);
}

#[test]
fn test_canary_weight_percentage_rollout() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "canary-weight-rule",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "baseline_upstream": "app_stable",
                "canary_upstream": "app_canary",
                "match_conditions": [],
                "weight_percentage": 20,
                "split_by": "client_ip",
                "canary_upstream_headers": [
                    { "name": "X-Canary", "value": "1" }
                ],
                "baseline_upstream_headers": []
            }
        ]
    }"#;

    let engine = CanaryReleaseEngine::from_snapshot(policy.as_bytes()).unwrap();

    let mut canary_count = 0;
    let mut baseline_count = 0;
    let total = 1000;

    for i in 0..total {
        let ip_str = format!("10.0.{}.{}", i / 256, i % 256);
        let req = eval_req(b"example.com", b"/", b"/", b"", ip_str.as_bytes(), 0);
        let decision = engine.evaluate(&req, |_| None);
        if decision.is_canary {
            assert_eq!(decision.upstream, "app_canary");
            assert_eq!(decision.upstream_headers, vec![("X-Canary".to_string(), "1".to_string())]);
            canary_count += 1;
        } else {
            assert_eq!(decision.upstream, "app_stable");
            assert!(decision.upstream_headers.is_empty());
            baseline_count += 1;
        }
    }

    let canary_pct = (canary_count as f64 / total as f64) * 100.0;
    let baseline_pct = (baseline_count as f64 / total as f64) * 100.0;
    assert!((15.0..=25.0).contains(&canary_pct), "Expected ~20% canary, got {canary_pct}%");
    assert!((75.0..=85.0).contains(&baseline_pct), "Expected ~80% baseline, got {baseline_pct}%");
}

#[test]
fn test_canary_invalid_policy_rejections() {
    // 1. Same baseline and canary upstream
    let same_upstreams = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bad-rule",
                "origin": "*",
                "path_prefix": "/",
                "baseline_upstream": "same_target",
                "canary_upstream": "same_target"
            }
        ]
    }"#;
    assert!(CanaryReleaseEngine::from_snapshot(same_upstreams.as_bytes()).is_err());

    // 2. Invalid regex pattern
    let bad_regex = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bad-rule",
                "origin": "*",
                "path_prefix": "/",
                "baseline_upstream": "b",
                "canary_upstream": "c",
                "match_conditions": [
                    { "target": "header", "key": "X", "regex": "(unclosed[" }
                ]
            }
        ]
    }"#;
    assert!(CanaryReleaseEngine::from_snapshot(bad_regex.as_bytes()).is_err());

    // 3. Weight > 100
    let bad_weight = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bad-rule",
                "origin": "*",
                "path_prefix": "/",
                "baseline_upstream": "b",
                "canary_upstream": "c",
                "weight_percentage": 101
            }
        ]
    }"#;
    assert!(CanaryReleaseEngine::from_snapshot(bad_weight.as_bytes()).is_err());
}
