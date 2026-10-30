use super::*;

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
fn test_flat_format_default_switch_header_works() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "active_slot": "blue",
        "blue_upstream": "app_blue",
        "green_upstream": "app_green"
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/api/v1/items");

    // Default x-deploy-slot must work even when omitted in flat format
    let d = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);
}

#[test]
fn test_longest_path_prefix_specificity_sorting() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "a-root-catchall",
                "priority": 100,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "root_blue",
                "green_upstream": "root_green"
            },
            {
                "id": "z-checkout-specific",
                "priority": 100,
                "origin": "*",
                "path_prefix": "/api/v1/checkout",
                "active_slot": "green",
                "blue_upstream": "checkout_blue",
                "green_upstream": "checkout_green"
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req_checkout = eval_req(b"example.com", b"/api/v1/checkout/pay");
    let d = engine.evaluate(&req_checkout, |_| None);
    assert!(d.matched);
    assert_eq!(d.rule_id, "z-checkout-specific");
    assert_eq!(d.upstream, "checkout_green");
}

#[test]
fn test_invalid_policy_rejections() {
    // 1. Same blue and green upstream
    let same = custom_policy_full("blue", "target", "target", "/", "");
    assert!(BlueGreenEngine::from_snapshot(same.as_bytes()).is_err());

    // 2. Invalid active slot
    let bad_slot = custom_policy("purple", "/", "");
    assert!(BlueGreenEngine::from_snapshot(bad_slot.as_bytes()).is_err());

    // 3. Missing upstreams
    let empty = r#"{ "schema_version": 1 }"#;
    assert!(BlueGreenEngine::from_snapshot(empty.as_bytes()).is_err());

    // 4. Invalid CIDR
    let bad_cidr = base_policy(r#", "allowed_cidrs": ["not-an-ip/33"]"#);
    assert!(BlueGreenEngine::from_snapshot(bad_cidr.as_bytes()).is_err());

    // 5. Trimmed duplicate upstreams ("app_blue" vs " app_blue ")
    let trimmed_same = custom_policy_full("blue", "app_blue", "  app_blue  ", "/", "");
    assert!(BlueGreenEngine::from_snapshot(trimmed_same.as_bytes()).is_err());

    // 6. CRLF header injection in upstream_headers
    let crlf_hdr = base_policy(r#", "blue_upstream_headers": [{ "name": "x-slot", "value": "blue\r\nX-Injected: pwned" }]"#);
    assert!(BlueGreenEngine::from_snapshot(crlf_hdr.as_bytes()).is_err());

    // 7. Invalid characters in secret_header
    let bad_secret_hdr = base_policy(r#", "preview_secret_header": "invalid header name!""#);
    assert!(BlueGreenEngine::from_snapshot(bad_secret_hdr.as_bytes()).is_err());
}
