use super::*;

#[test]
fn test_default_active_blue_slot() {
    let policy = custom_policy(
        "blue",
        "/api",
        r#",
        "blue_upstream_headers": [{ "name": "x-slot", "value": "blue" }],
        "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
        "#,
    );

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/api/v1/resource");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_blue");
    assert_eq!(d.active_slot, "blue");
    assert!(!d.is_header_override);
    assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "blue".to_string())]);
}

#[test]
fn test_active_green_slot() {
    let policy = custom_policy(
        "green",
        "/api",
        r#",
        "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
        "#,
    );

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
    let policy = base_policy(
        r#",
        "blue_upstream_headers": [{ "name": "x-slot", "value": "blue" }],
        "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
        "#,
    );

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/dashboard");

    // 1. Override to green (lowercase)
    let d_green = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
    assert!(d_green.matched);
    assert_eq!(d_green.upstream, "app_green");
    assert!(d_green.is_header_override);

    // 2. Override to green (SWAR uppercase "GREEN")
    let d_green_upper = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"GREEN"));
    assert!(d_green_upper.matched);
    assert_eq!(d_green_upper.upstream, "app_green");
    assert!(d_green_upper.is_header_override);

    // 3. Override to blue
    let d_blue = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"blue"));
    assert!(d_blue.matched);
    assert_eq!(d_blue.upstream, "app_blue");
    assert!(d_blue.is_header_override);

    // 4. Invalid header value falls back to active slot (blue)
    let d_fallback = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"staging"));
    assert!(d_fallback.matched);
    assert_eq!(d_fallback.upstream, "app_blue");
    assert!(!d_fallback.is_header_override);
}

#[test]
fn test_cookie_preview_override() {
    let policy = base_policy(r#", "preview_cookie": "deploy_slot""#);
    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/home");

    // Cookie overrides to green
    let d = engine.evaluate(&req, |k| {
        (k == "cookie").then_some(b"session=abc123; deploy_slot=green; tracking=xyz")
    });
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);

    // Cookie without target name falls back to active blue
    let d2 = engine.evaluate(&req, |k| {
        (k == "cookie").then_some(b"session=abc123; other_cookie=green")
    });
    assert!(d2.matched);
    assert_eq!(d2.upstream, "app_blue");
    assert!(!d2.is_header_override);
}

#[test]
fn test_query_param_preview_override() {
    let policy = base_policy(r#", "preview_query_param": "deploy_slot""#);
    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    let req_green = eval_req_full(
        b"example.com",
        b"/search",
        b"127.0.0.1",
        b"q=rust&deploy_slot=green&page=1",
    );
    let d = engine.evaluate(&req_green, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);

    let req_blue = eval_req_full(b"example.com", b"/search", b"127.0.0.1", b"q=rust&page=1");
    let d2 = engine.evaluate(&req_blue, |_| None);
    assert!(d2.matched);
    assert_eq!(d2.upstream, "app_blue");
    assert!(!d2.is_header_override);
}
