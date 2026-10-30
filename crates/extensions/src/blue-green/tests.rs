use super::*;

fn test_engine(json_str: &str) -> BlueGreenEngine {
    BlueGreenEngine::from_snapshot(json_str.as_bytes()).unwrap()
}

#[test]
fn test_slot_sheet_cacheline_size() {
    assert_eq!(std::mem::size_of::<SlotUpstreamMeta>(), 32);
    assert_eq!(std::mem::size_of::<SlotSheet>(), 64);
    assert_eq!(std::mem::align_of::<SlotSheet>(), 64);
}

#[test]
fn test_branchless_selection_arithmetic() {
    assert_eq!(select_slot_branchless(1, SLOT_GREEN, SLOT_BLUE), SLOT_GREEN);
    assert_eq!(select_slot_branchless(1, SLOT_BLUE, SLOT_GREEN), SLOT_BLUE);
    assert_eq!(select_slot_branchless(0, SLOT_GREEN, SLOT_BLUE), SLOT_BLUE);
    assert_eq!(select_slot_branchless(0, SLOT_BLUE, SLOT_GREEN), SLOT_GREEN);
}

#[test]
fn test_swar_slot_parser() {
    assert_eq!(parse_slot_swar(b"blue"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"BLUE"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"Blue"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"  blue \t"), Some(SLOT_BLUE));

    assert_eq!(parse_slot_swar(b"green"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"GREEN"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"Green"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"  green \r\n"), Some(SLOT_GREEN));

    assert_eq!(parse_slot_swar(b"staging"), None);
    assert_eq!(parse_slot_swar(b"canary"), None);
    assert_eq!(parse_slot_swar(b""), None);
    assert_eq!(parse_slot_swar(b"blu"), None);
    assert_eq!(parse_slot_swar(b"gree"), None);
}

#[test]
fn test_extract_cookie_value() {
    let cookie = b"session=abc123; Deploy_Slot=green; tracking=xyz";
    assert_eq!(extract_cookie_value(cookie, b"deploy_slot"), Some(&b"green"[..]));
    assert_eq!(extract_cookie_value(cookie, b"DEPLOY_SLOT"), Some(&b"green"[..]));
    assert_eq!(extract_cookie_value(cookie, b"session"), Some(&b"abc123"[..]));
    assert_eq!(extract_cookie_value(cookie, b"not_found"), None);
    assert_eq!(extract_cookie_value(cookie, b""), None);
}

#[test]
fn test_extract_query_value() {
    let query = b"foo=bar&Deploy_Slot=green&baz=123";
    assert_eq!(extract_query_value(query, b"deploy_slot"), Some(&b"green"[..]));
    assert_eq!(extract_query_value(query, b"DEPLOY_SLOT"), Some(&b"green"[..]));
    assert_eq!(extract_query_value(query, b"baz"), Some(&b"123"[..]));
    assert_eq!(extract_query_value(query, b"not_found"), None);
}

#[test]
fn test_verify_preview_secret() {
    let secret = "top-secret-2026";
    let secret_bytes = secret.as_bytes();
    let secret_hash = fnv1a_64(secret_bytes);

    // Header check
    assert_eq!(
        verify_preview_secret(secret_hash, Some(secret_bytes), Some("x-preview-secret"), b"", &|k| {
            (k == "x-preview-secret").then_some(b"top-secret-2026")
        }),
        1
    );

    // Cookie check
    assert_eq!(
        verify_preview_secret(secret_hash, Some(secret_bytes), Some("x-preview-secret"), b"", &|k| {
            (k == "cookie").then_some(b"preview_secret=top-secret-2026")
        }),
        1
    );

    // Query check
    assert_eq!(
        verify_preview_secret(
            secret_hash,
            Some(secret_bytes),
            Some("x-preview-secret"),
            b"preview_secret=top-secret-2026",
            &|_| None
        ),
        1
    );

    // Wrong secret -> 0
    assert_eq!(
        verify_preview_secret(secret_hash, Some(secret_bytes), Some("x-preview-secret"), b"", &|k| {
            (k == "x-preview-secret").then_some(b"wrong-key")
        }),
        0
    );

    // Constant time comparison works
    assert!(constant_time_eq(b"hello", b"hello"));
    assert!(!constant_time_eq(b"hello", b"world"));
    assert!(!constant_time_eq(b"hello", b"hell"));
}

#[test]
fn test_verify_cidr_boundary() {
    let cidrs = [(167772160, 4278190080)]; // 10.0.0.0/8
    assert_eq!(verify_cidr_boundary(&cidrs, b"10.1.2.3"), 1);
    assert_eq!(verify_cidr_boundary(&cidrs, b"192.168.1.1"), 0);
    assert_eq!(verify_cidr_boundary(&cidrs, b"not-an-ip"), 0);
    assert_eq!(verify_cidr_boundary(&[], b"192.168.1.1"), 1);
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
    assert_eq!(engine.rules_count(), 1);
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
    let req = BlueGreenEvalRequest::new(b"example.com", b"/api/v1/checkout/pay");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.rule_id, "z-checkout-specific");
    assert_eq!(d.upstream, "checkout_green");
}

#[test]
fn test_invalid_policy_rejections() {
    // Same blue and green upstream
    let same = r#"{
        "schema_version": 1, "generation": 1,
        "rules": [{
            "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "blue",
            "blue_upstream": "target", "green_upstream": "target"
        }]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(same.as_bytes()).is_err());

    // Invalid active slot
    let bad_slot = r#"{
        "schema_version": 1, "generation": 1,
        "rules": [{
            "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "purple",
            "blue_upstream": "blue", "green_upstream": "green"
        }]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(bad_slot.as_bytes()).is_err());

    // Missing upstreams
    let empty = r#"{ "schema_version": 1 }"#;
    assert!(BlueGreenEngine::from_snapshot(empty.as_bytes()).is_err());

    // Invalid CIDR
    let bad_cidr = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "blue", "green_upstream": "green",
        "allowed_cidrs": ["not-an-ip/33"]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(bad_cidr.as_bytes()).is_err());

    // Trimmed duplicate upstreams ("app_blue" vs "  app_blue  ")
    let trimmed_same = r#"{
        "schema_version": 1, "generation": 1,
        "rules": [{
            "id": "r1", "origin": "*", "path_prefix": "/", "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "  app_blue  "
        }]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(trimmed_same.as_bytes()).is_err());

    // CRLF header injection in upstream_headers
    let crlf_hdr = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "blue", "green_upstream": "green",
        "blue_upstream_headers": [{ "name": "x-slot", "value": "blue\r\nX-Injected: pwned" }]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(crlf_hdr.as_bytes()).is_err());

    // Invalid characters in secret_header
    let bad_secret_hdr = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "blue", "green_upstream": "green",
        "preview_secret_header": "invalid header name!"
    }"#;
    assert!(BlueGreenEngine::from_snapshot(bad_secret_hdr.as_bytes()).is_err());
}

#[test]
fn test_default_active_blue_slot() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "blue_upstream_headers": [{ "name": "x-slot", "value": "blue" }],
        "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
    }"#;
    let engine = test_engine(json);
    let req = BlueGreenEvalRequest::new(b"example.com", b"/api");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_blue");
    assert_eq!(d.active_slot, "blue");
    assert!(!d.is_header_override);
    assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "blue".to_string())]);
}

#[test]
fn test_active_green_slot() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "green",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
    }"#;
    let engine = test_engine(json);
    let req = BlueGreenEvalRequest::new(b"example.com", b"/api");
    let d = engine.evaluate(&req, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert_eq!(d.active_slot, "green");
    assert!(!d.is_header_override);
    assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "green".to_string())]);
}

#[test]
fn test_switch_header_override() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "switch_header": "x-deploy-slot"
    }"#;
    let engine = test_engine(json);
    let req = BlueGreenEvalRequest::new(b"example.com", b"/dashboard");

    // Override to green (lowercase)
    let d_green = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
    assert!(d_green.matched);
    assert_eq!(d_green.upstream, "app_green");
    assert!(d_green.is_header_override);

    // Override to green (SWAR uppercase "GREEN")
    let d_green_upper = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"GREEN"));
    assert!(d_green_upper.matched);
    assert_eq!(d_green_upper.upstream, "app_green");
    assert!(d_green_upper.is_header_override);

    // Invalid value falls back to active blue
    let d_fallback = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"staging"));
    assert!(d_fallback.matched);
    assert_eq!(d_fallback.upstream, "app_blue");
    assert!(!d_fallback.is_header_override);
}

#[test]
fn test_cookie_preview_override() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "preview_cookie": "deploy_slot"
    }"#;
    let engine = test_engine(json);
    let req = BlueGreenEvalRequest::new(b"example.com", b"/home");

    let d = engine.evaluate(&req, |k| {
        (k == "cookie").then_some(b"session=abc123; deploy_slot=green; tracking=xyz")
    });
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);
}

#[test]
fn test_query_param_preview_override() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "preview_query_param": "deploy_slot"
    }"#;
    let engine = test_engine(json);
    let req_green = BlueGreenEvalRequest::with_details(
        b"example.com",
        b"/search",
        b"127.0.0.1",
        b"q=rust&deploy_slot=green&page=1",
    );
    let d = engine.evaluate(&req_green, |_| None);
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);
}

#[test]
fn test_preview_secret_security_guard() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "switch_header": "x-deploy-slot",
        "preview_secret": "stage-secret-2026",
        "preview_secret_header": "x-preview-secret"
    }"#;
    let engine = test_engine(json);
    let req = BlueGreenEvalRequest::new(b"example.com", b"/api");

    // Attacker without secret -> Fallback to blue
    let d_forged = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
    assert_eq!(d_forged.upstream, "app_blue");
    assert!(!d_forged.is_header_override);

    // Attacker with wrong secret -> Fallback to blue
    let d_wrong = engine.evaluate(&req, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"wrong-key"),
        _ => None,
    });
    assert_eq!(d_wrong.upstream, "app_blue");
    assert!(!d_wrong.is_header_override);

    // Authorized with valid secret -> Routed to green
    let d_auth = engine.evaluate(&req, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"stage-secret-2026"),
        _ => None,
    });
    assert_eq!(d_auth.upstream, "app_green");
    assert!(d_auth.is_header_override);
}

#[test]
fn test_preview_cidr_and_secret_combined() {
    let json = r#"{
        "schema_version": 1, "generation": 1, "active_slot": "blue",
        "blue_upstream": "app_blue", "green_upstream": "app_green",
        "switch_header": "x-deploy-slot",
        "preview_secret": "top-secret-key",
        "allowed_cidrs": ["10.0.0.0/8"]
    }"#;
    let engine = test_engine(json);

    // Valid secret but external IP (8.8.8.8) -> Fallback to blue
    let req_ext = BlueGreenEvalRequest::with_details(b"example.com", b"/", b"8.8.8.8", b"");
    let d1 = engine.evaluate(&req_ext, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"top-secret-key"),
        _ => None,
    });
    assert_eq!(d1.upstream, "app_blue");

    // Valid secret and internal IP (10.1.2.3) -> ALLOWED Green!
    let req_int = BlueGreenEvalRequest::with_details(b"example.com", b"/", b"10.1.2.3", b"");
    let d2 = engine.evaluate(&req_int, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"top-secret-key"),
        _ => None,
    });
    assert_eq!(d2.upstream, "app_green");
    assert!(d2.is_header_override);
}
