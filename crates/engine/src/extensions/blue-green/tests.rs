use super::*;

fn eval_req<'a>(origin: &'a [u8], path: &'a [u8]) -> BlueGreenEvalRequest<'a> {
    BlueGreenEvalRequest { origin, path }
}

#[test]
fn test_default_active_blue_slot() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-rule-1",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "blue_upstream_headers": [
                    { "name": "x-slot", "value": "blue" }
                ],
                "green_upstream_headers": [
                    { "name": "x-slot", "value": "green" }
                ]
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    let req = eval_req(b"example.com", b"/api/v1/resource");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.rule_id, "bg-rule-1");
    assert_eq!(d.upstream, "app_blue");
    assert_eq!(d.active_slot, "blue");
    assert!(!d.is_header_override);
    assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "blue".to_string())]);
}

#[test]
fn test_active_green_slot() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 2,
        "rules": [
            {
                "id": "bg-rule-2",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/api",
                "active_slot": "green",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "blue_upstream_headers": [],
                "green_upstream_headers": [
                    { "name": "x-slot", "value": "green" }
                ]
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    let req = eval_req(b"example.com", b"/api/v1/resource");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert_eq!(d.active_slot, "green");
    assert!(!d.is_header_override);
    assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "green".to_string())]);
}

#[test]
fn test_switch_header_override() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-rule-override",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "blue_upstream_headers": [
                    { "name": "x-slot", "value": "blue" }
                ],
                "green_upstream_headers": [
                    { "name": "x-slot", "value": "green" }
                ]
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/dashboard");

    // 1. Override to green
    let d_green = engine.evaluate(&req, |k| if k == "x-deploy-slot" { Some(b"green") } else { None });
    assert!(d_green.matched);
    assert_eq!(d_green.upstream, "app_green");
    assert_eq!(d_green.active_slot, "green");
    assert!(d_green.is_header_override);
    assert_eq!(d_green.upstream_headers, &[("x-slot".to_string(), "green".to_string())]);

    // 2. Override to blue
    let d_blue = engine.evaluate(&req, |k| if k == "x-deploy-slot" { Some(b"blue") } else { None });
    assert!(d_blue.matched);
    assert_eq!(d_blue.upstream, "app_blue");
    assert_eq!(d_blue.active_slot, "blue");
    assert!(d_blue.is_header_override);

    // 3. Invalid header value falls back to active slot (blue)
    let d_fallback = engine.evaluate(&req, |k| if k == "x-deploy-slot" { Some(b"staging") } else { None });
    assert!(d_fallback.matched);
    assert_eq!(d_fallback.upstream, "app_blue");
    assert_eq!(d_fallback.active_slot, "blue");
    assert!(!d_fallback.is_header_override);
}

#[test]
fn test_flat_format_compatibility() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 5,
        "active_slot": "green",
        "blue_upstream": "app_blue",
        "green_upstream": "app_green",
        "switch_header": "x-deploy-slot"
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    assert_eq!(engine.rules_count(), 1);

    let req = eval_req(b"example.com", b"/home");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert_eq!(d.active_slot, "green");
}

#[test]
fn test_invalid_policy_rejections() {
    // 1. Same blue and green upstream
    let same = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r1",
                "blue_upstream": "target",
                "green_upstream": "target"
            }
        ]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(same.as_bytes()).is_err());

    // 2. Invalid active slot
    let bad_slot = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r2",
                "active_slot": "purple",
                "blue_upstream": "b",
                "green_upstream": "g"
            }
        ]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(bad_slot.as_bytes()).is_err());

    // 3. Missing upstreams
    let empty = r#"{ "schema_version": 1 }"#;
    assert!(BlueGreenEngine::from_snapshot(empty.as_bytes()).is_err());
}
