use super::*;

#[test]
fn test_preview_secret_security_guard() {
    let policy = base_policy(
        r#",
        "preview_secret": "stage-secret-2026",
        "preview_secret_header": "x-preview-secret"
        "#,
    );

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/api");

    // 1. Attacker sends X-Deploy-Slot: green without secret -> REJECTED (Fallback to blue)
    let d_forged = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else {
            None
        }
    });
    assert!(d_forged.matched);
    assert_eq!(d_forged.upstream, "app_blue");
    assert!(!d_forged.is_header_override);

    // 2. Attacker sends X-Deploy-Slot: green with wrong secret -> REJECTED (Fallback to blue)
    let d_wrong_secret = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else if k == "x-preview-secret" {
            Some(b"wrong-password")
        } else {
            None
        }
    });
    assert!(d_wrong_secret.matched);
    assert_eq!(d_wrong_secret.upstream, "app_blue");
    assert!(!d_wrong_secret.is_header_override);

    // 3. Authorized internal engineer sends valid secret -> ALLOWED (Routed to green)
    let d_authorized = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else if k == "x-preview-secret" {
            Some(b"stage-secret-2026")
        } else {
            None
        }
    });
    assert!(d_authorized.matched);
    assert_eq!(d_authorized.upstream, "app_green");
    assert!(d_authorized.is_header_override);
}

#[test]
fn test_preview_cidr_security_guard() {
    let policy = base_policy(r#", "allowed_cidrs": ["10.0.0.0/8", "192.168.1.0/24"]"#);
    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    // 1. External public IP (203.0.113.50) -> REJECTED (Fallback to blue)
    let req_ext = eval_req_full(b"example.com", b"/", b"203.0.113.50", b"");
    let d_ext = engine.evaluate(&req_ext, |k| {
        (k == "x-deploy-slot").then_some(b"green")
    });
    assert_eq!(d_ext.upstream, "app_blue");
    assert!(!d_ext.is_header_override);

    // 2. Internal VPC IP (10.240.1.15) -> ALLOWED (Routed to green)
    let req_vpc = eval_req_full(b"example.com", b"/", b"10.240.1.15", b"");
    let d_vpc = engine.evaluate(&req_vpc, |k| {
        (k == "x-deploy-slot").then_some(b"green")
    });
    assert_eq!(d_vpc.upstream, "app_green");
    assert!(d_vpc.is_header_override);

    // 3. Internal office subnet (192.168.1.42) -> ALLOWED (Routed to green)
    let req_office = eval_req_full(b"example.com", b"/", b"192.168.1.42", b"");
    let d_office = engine.evaluate(&req_office, |k| {
        (k == "x-deploy-slot").then_some(b"green")
    });
    assert_eq!(d_office.upstream, "app_green");
    assert!(d_office.is_header_override);
}

#[test]
fn test_combined_secret_and_cidr_guard() {
    let policy = base_policy(
        r#",
        "preview_secret": "top-secret-key",
        "allowed_cidrs": ["10.0.0.0/8"]
        "#,
    );
    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    // Correct secret BUT wrong IP -> Falls back to blue
    let req_wrong_ip = eval_req_full(b"example.com", b"/", b"8.8.8.8", b"");
    let d1 = engine.evaluate(&req_wrong_ip, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"top-secret-key"),
        _ => None,
    });
    assert_eq!(d1.upstream, "app_blue");

    // Correct IP BUT wrong secret -> Falls back to blue
    let req_correct_ip = eval_req_full(b"example.com", b"/", b"10.1.2.3", b"");
    let d2 = engine.evaluate(&req_correct_ip, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"wrong-key"),
        _ => None,
    });
    assert_eq!(d2.upstream, "app_blue");

    // Correct IP AND correct secret -> GREEN!
    let d3 = engine.evaluate(&req_correct_ip, |k| match k {
        "x-deploy-slot" => Some(b"green"),
        "x-preview-secret" => Some(b"top-secret-key"),
        _ => None,
    });
    assert_eq!(d3.upstream, "app_green");
    assert!(d3.is_header_override);
}

#[test]
fn test_mixed_case_cookie_and_query_param_and_cookie_secret() {
    let policy = base_policy(
        r#",
        "preview_cookie": "X_Deploy_Slot",
        "preview_query_param": "deploySlot",
        "preview_secret": "  stage-secret-2026  "
        "#,
    );
    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/home");

    // 1. Cookie with mixed-case name + cookie-supplied preview_secret
    let d_cookie = engine.evaluate(&req, |k| {
        (k == "cookie").then_some(b"X_Deploy_Slot=green; preview_secret=stage-secret-2026")
    });
    assert!(d_cookie.matched);
    assert_eq!(d_cookie.upstream, "app_green");
    assert!(d_cookie.is_header_override);

    // 2. Query param with mixed-case name + query-supplied preview_secret
    let req_query = eval_req_full(
        b"example.com",
        b"/home",
        b"127.0.0.1",
        b"deploySlot=GREEN&preview_secret=stage-secret-2026",
    );
    let d_query = engine.evaluate(&req_query, |_| None);
    assert!(d_query.matched);
    assert_eq!(d_query.upstream, "app_green");
    assert!(d_query.is_header_override);
}
