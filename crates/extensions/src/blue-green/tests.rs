use super::*;

fn eval_req<'a>(origin: &'a [u8], path: &'a [u8]) -> BlueGreenEvalRequest<'a> {
    BlueGreenEvalRequest::new(origin, path)
}

fn eval_req_full<'a>(
    origin: &'a [u8],
    path: &'a [u8],
    client_ip: &'a [u8],
    query: &'a [u8],
) -> BlueGreenEvalRequest<'a> {
    BlueGreenEvalRequest::with_details(origin, path, client_ip, query)
}

#[test]
fn test_branchless_selection_arithmetic() {
    // valid_override = 1 -> returns candidate_slot
    assert_eq!(select_slot_branchless(1, SLOT_GREEN, SLOT_BLUE), SLOT_GREEN);
    assert_eq!(select_slot_branchless(1, SLOT_BLUE, SLOT_GREEN), SLOT_BLUE);

    // valid_override = 0 -> returns active_slot
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
    assert_eq!(
        d.upstream_headers,
        &[("x-slot".to_string(), "blue".to_string())]
    );
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
    assert_eq!(
        d.upstream_headers,
        &[("x-slot".to_string(), "green".to_string())]
    );
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

    // 1. Override to green (lowercase)
    let d_green = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else {
            None
        }
    });
    assert!(d_green.matched);
    assert_eq!(d_green.upstream, "app_green");
    assert_eq!(d_green.active_slot, "green");
    assert!(d_green.is_header_override);
    assert_eq!(
        d_green.upstream_headers,
        &[("x-slot".to_string(), "green".to_string())]
    );

    // 2. Override to green (SWAR uppercase "GREEN")
    let d_green_upper = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"GREEN")
        } else {
            None
        }
    });
    assert!(d_green_upper.matched);
    assert_eq!(d_green_upper.upstream, "app_green");
    assert!(d_green_upper.is_header_override);

    // 3. Override to blue
    let d_blue = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"blue")
        } else {
            None
        }
    });
    assert!(d_blue.matched);
    assert_eq!(d_blue.upstream, "app_blue");
    assert_eq!(d_blue.active_slot, "blue");
    assert!(d_blue.is_header_override);

    // 4. Invalid header value falls back to active slot (blue)
    let d_fallback = engine.evaluate(&req, |k| {
        if k == "x-deploy-slot" {
            Some(b"staging")
        } else {
            None
        }
    });
    assert!(d_fallback.matched);
    assert_eq!(d_fallback.upstream, "app_blue");
    assert_eq!(d_fallback.active_slot, "blue");
    assert!(!d_fallback.is_header_override);
}

#[test]
fn test_cookie_preview_override() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-cookie",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "preview_cookie": "deploy_slot",
                "blue_upstream_headers": [],
                "green_upstream_headers": []
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();
    let req = eval_req(b"example.com", b"/home");

    // Cookie overrides to green
    let d = engine.evaluate(&req, |k| {
        if k == "cookie" {
            Some(b"session=abc123; deploy_slot=green; tracking=xyz")
        } else {
            None
        }
    });
    assert!(d.matched);
    assert_eq!(d.upstream, "app_green");
    assert!(d.is_header_override);

    // Cookie without target name falls back to active blue
    let d2 = engine.evaluate(&req, |k| {
        if k == "cookie" {
            Some(b"session=abc123; other_cookie=green")
        } else {
            None
        }
    });
    assert!(d2.matched);
    assert_eq!(d2.upstream, "app_blue");
    assert!(!d2.is_header_override);
}

#[test]
fn test_query_param_preview_override() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-query",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "preview_query_param": "deploy_slot",
                "blue_upstream_headers": [],
                "green_upstream_headers": []
            }
        ]
    }"#;

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

#[test]
fn test_preview_secret_security_guard() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-secured",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "preview_secret": "stage-secret-2026",
                "preview_secret_header": "x-preview-secret"
            }
        ]
    }"#;

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
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-cidr",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "allowed_cidrs": ["10.0.0.0/8", "192.168.1.0/24"]
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    // 1. Client from external public IP (203.0.113.50) -> REJECTED (Fallback to blue)
    let req_ext = eval_req_full(b"example.com", b"/", b"203.0.113.50", b"");
    let d_ext = engine.evaluate(&req_ext, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else {
            None
        }
    });
    assert_eq!(d_ext.upstream, "app_blue");
    assert!(!d_ext.is_header_override);

    // 2. Client from internal VPC IP (10.240.1.15) -> ALLOWED (Routed to green)
    let req_vpc = eval_req_full(b"example.com", b"/", b"10.240.1.15", b"");
    let d_vpc = engine.evaluate(&req_vpc, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else {
            None
        }
    });
    assert_eq!(d_vpc.upstream, "app_green");
    assert!(d_vpc.is_header_override);

    // 3. Client from internal office subnet (192.168.1.42) -> ALLOWED (Routed to green)
    let req_office = eval_req_full(b"example.com", b"/", b"192.168.1.42", b"");
    let d_office = engine.evaluate(&req_office, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else {
            None
        }
    });
    assert_eq!(d_office.upstream, "app_green");
    assert!(d_office.is_header_override);
}

#[test]
fn test_combined_secret_and_cidr_guard() {
    let policy = r#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": "bg-fortress",
                "priority": 10,
                "origin": "*",
                "path_prefix": "/",
                "active_slot": "blue",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot",
                "preview_secret": "top-secret-key",
                "allowed_cidrs": ["10.0.0.0/8"]
            }
        ]
    }"#;

    let engine = BlueGreenEngine::from_snapshot(policy.as_bytes()).unwrap();

    // Correct secret BUT wrong IP -> Falls back to blue
    let req_wrong_ip = eval_req_full(b"example.com", b"/", b"8.8.8.8", b"");
    let d1 = engine.evaluate(&req_wrong_ip, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else if k == "x-preview-secret" {
            Some(b"top-secret-key")
        } else {
            None
        }
    });
    assert_eq!(d1.upstream, "app_blue");

    // Correct IP BUT wrong secret -> Falls back to blue
    let req_correct_ip = eval_req_full(b"example.com", b"/", b"10.1.2.3", b"");
    let d2 = engine.evaluate(&req_correct_ip, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else if k == "x-preview-secret" {
            Some(b"wrong-key")
        } else {
            None
        }
    });
    assert_eq!(d2.upstream, "app_blue");

    // Correct IP AND correct secret -> GREEN!
    let d3 = engine.evaluate(&req_correct_ip, |k| {
        if k == "x-deploy-slot" {
            Some(b"green")
        } else if k == "x-preview-secret" {
            Some(b"top-secret-key")
        } else {
            None
        }
    });
    assert_eq!(d3.upstream, "app_green");
    assert!(d3.is_header_override);
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

    // 4. Invalid CIDR
    let bad_cidr = r#"{
        "schema_version": 1,
        "rules": [
            {
                "id": "r3",
                "blue_upstream": "b",
                "green_upstream": "g",
                "allowed_cidrs": ["not-an-ip/33"]
            }
        ]
    }"#;
    assert!(BlueGreenEngine::from_snapshot(bad_cidr.as_bytes()).is_err());
}
