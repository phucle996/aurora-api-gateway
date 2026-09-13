use super::engine::JwtEngine;
use super::types::JwtDecision;
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::Serialize;

#[derive(Serialize)]
struct TestClaims {
    sub: String,
    role: String,
    tenant_id: String,
    exp: usize,
}

#[test]
fn test_snapshot_deserialization_with_rules_and_host_origin_alias() {
    let raw = br#"{
  "schema_version": 1,
  "generation": 1,
  "rules": [
    {
      "algorithm": "RS256",
      "audience": "aurora-gateway",
      "clock_skew_secs": 60,
      "exclude_paths": [
        "/api/auth/login",
        "/api/healthz",
        "/api/public/"
      ],
      "forward_headers": [
        {
          "header_key": "X-User-Id",
          "payload_key": "sub",
          "value": "*"
        }
      ],
      "host": "*",
      "id": "main-api-origin",
      "issuer": "https://auth.aurora.local",
      "keys": [
        {
          "is_primary": true,
          "kid": "key-2026-09",
          "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn7DE87UDxm5+ziZltyDP\ndf+GG8FbBgk3xb6yFnN5NgwhJJ/fv26Jx3GhPTumP6viDuQZYmG+5nBEf9hQLJMS\nypcGvr5RiEnPe5lgAmqYUp6e4WK9hk3XxBECCwcAIkBUGW88EjduR/PLLtLDn8dt\nqHUb9Z8WQVzp+1uwoLENdIzrYhIBejfIOFqFKCNGLz8MlNxSmDWz5hEe1SNQu/wk\ngTSKRe8b5ztT73oM6cvCLqOOXc5sxsIsq0R+tNXDxxEcxFpFs+7DMvLceAghCgmn\nLNT+PNZNBzXTl2UAY6KCbtCO61I9yAk5C7hRKjp7/qhnqc1dUUp04at6ZsumCTj2\n2QIDAQAB\n-----END PUBLIC KEY-----\n"
        }
      ],
      "origin": "*",
      "path_prefix": "/api"
    }
  ]
}"#;
    assert!(JwtEngine::from_snapshot(raw).is_ok());
}

#[test]
fn rejects_incomplete_or_private_key_snapshots() {
    assert!(JwtEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"origins":[]}"#).is_err());
    assert!(
        JwtEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"origins":[{"id":"admin","origin":"api.example.test","public_key_pem":"-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----"}]}"#).is_err()
    );
}

#[test]
fn test_symmetric_hs256_with_exclude_paths_and_forward_headers() {
    let secret = "super-shared-secret-key-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 10,
        "origins": [
            {
                "id": "shop-api",
                "origin": "api.shop.local",
                "path_prefix": "/api",
                "exclude_paths": ["/api/auth/login", "/api/healthz"],
                "algorithm": "HS256",
                "secret": secret,
                "forward_headers": [
                    { "payload_key": "sub", "header_key": "X-User-Id", "value": "*" },
                    { "payload_key": "role", "header_key": "X-User-Role", "value": "^(admin|operator)$" },
                    { "payload_key": "tenant_id", "header_key": "X-Tenant-Id", "value": "^T-[0-9]+$" }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // 1. Exclude paths should bypass without token
    let bypass_res = engine
        .evaluate(b"api.shop.local", b"/api/auth/login", None)
        .unwrap();
    assert_eq!(
        bypass_res,
        JwtDecision::Allow {
            forwarded_headers: vec![]
        }
    );

    let bypass_health = engine
        .evaluate(b"api.shop.local", b"/api/healthz", None)
        .unwrap();
    assert_eq!(
        bypass_health,
        JwtDecision::Allow {
            forwarded_headers: vec![]
        }
    );

    // 2. Unmatched origin should bypass
    let other_host = engine
        .evaluate(b"other.shop.local", b"/api/orders", None)
        .unwrap();
    assert_eq!(
        other_host,
        JwtDecision::Allow {
            forwarded_headers: vec![]
        }
    );

    // 3. Protected path without token -> Unauthorized
    let no_token = engine
        .evaluate(b"api.shop.local", b"/api/orders", None)
        .unwrap();
    assert_eq!(no_token, JwtDecision::Unauthorized);

    // 4. Valid token with matching role and matching tenant -> Allowed + Headers injected
    let claims = TestClaims {
        sub: "user_42".to_string(),
        role: "admin".to_string(),
        tenant_id: "T-999".to_string(),
        exp: 2000000000,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let auth_hdr = format!("Bearer {token}");

    let allowed = engine
        .evaluate(b"api.shop.local", b"/api/orders", Some(auth_hdr.as_bytes()))
        .unwrap();
    match allowed {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 3);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Id".to_string(), "user_42".to_string())
            );
            assert_eq!(
                forwarded_headers[1],
                ("X-User-Role".to_string(), "admin".to_string())
            );
            assert_eq!(
                forwarded_headers[2],
                ("X-Tenant-Id".to_string(), "T-999".to_string())
            );
        }
        JwtDecision::Unauthorized => panic!("Expected allowed"),
    }

    // 5. Token with role that fails regex -> Role header omitted!
    let guest_claims = TestClaims {
        sub: "user_99".to_string(),
        role: "guest".to_string(), // Doesn't match ^(admin|operator)$
        tenant_id: "T-111".to_string(),
        exp: 2000000000,
    };
    let guest_token = encode(
        &Header::default(),
        &guest_claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let guest_auth = format!("Bearer {guest_token}");

    let guest_res = engine
        .evaluate(
            b"api.shop.local",
            b"/api/orders",
            Some(guest_auth.as_bytes()),
        )
        .unwrap();
    match guest_res {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 2);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Id".to_string(), "user_99".to_string())
            );
            assert_eq!(
                forwarded_headers[1],
                ("X-Tenant-Id".to_string(), "T-111".to_string())
            );
        }
        JwtDecision::Unauthorized => panic!("Expected allowed"),
    }
}

#[test]
fn test_key_rotation_with_kid_lookup() {
    let secret1 = "secret-key-1-old";
    let secret2 = "secret-key-2-new";

    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 11,
        "origins": [
            {
                "id": "key-rotation-api",
                "origin": "*",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "keys": [
                    { "kid": "key-2", "secret": secret2, "is_primary": true },
                    { "kid": "key-1", "secret": secret1 }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // Token signed with Key 1
    let h1 = Header {
        kid: Some("key-1".to_string()),
        ..Default::default()
    };
    let t1 = encode(
        &h1,
        &serde_json::json!({"sub":"user1", "exp":2000000000}),
        &EncodingKey::from_secret(secret1.as_bytes()),
    )
    .unwrap();
    let r1 = engine
        .evaluate(
            b"example.test",
            b"/api/test",
            Some(format!("Bearer {t1}").as_bytes()),
        )
        .unwrap();
    assert!(matches!(r1, JwtDecision::Allow { .. }));

    // Token signed with Key 2
    let h2 = Header {
        kid: Some("key-2".to_string()),
        ..Default::default()
    };
    let t2 = encode(
        &h2,
        &serde_json::json!({"sub":"user2", "exp":2000000000}),
        &EncodingKey::from_secret(secret2.as_bytes()),
    )
    .unwrap();
    let r2 = engine
        .evaluate(
            b"example.test",
            b"/api/test",
            Some(format!("Bearer {t2}").as_bytes()),
        )
        .unwrap();
    assert!(matches!(r2, JwtDecision::Allow { .. }));

    // Token with unknown kid falls back to primary key (Key 2)
    let h_unknown = Header {
        kid: Some("unknown-key".to_string()),
        ..Default::default()
    };
    let t_unknown_signed_by_key2 = encode(
        &h_unknown,
        &serde_json::json!({"sub":"user3", "exp":2000000000}),
        &EncodingKey::from_secret(secret2.as_bytes()),
    )
    .unwrap();
    let r_fallback = engine
        .evaluate(
            b"example.test",
            b"/api/test",
            Some(format!("Bearer {t_unknown_signed_by_key2}").as_bytes()),
        )
        .unwrap();
    assert!(matches!(r_fallback, JwtDecision::Allow { .. }));
}

#[test]
fn test_unified_claim_matrix_and_relaxed_exp() {
    let secret = "test-secret-unified-matrix-123456";
    let policy = serde_json::json!({
        "schema_version": 1,
        "generation": 2,
        "origins": [
            {
                "id": "matrix-origin",
                "origin": "api.matrix.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "require_exp": false,
                "claim_rules": [
                    { "payload_key": "iss", "values_match": "https://auth.matrix.local", "required": true },
                    { "payload_key": "role", "values_match": "^(admin|operator)$", "header_key": "X-User-Role", "required": true },
                    { "payload_key": "sub", "values_match": "*", "header_key": "X-User-Id", "required": true },
                    { "payload_key": "dept", "values_match": "*", "header_key": "X-Department", "required": false }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy.to_string().as_bytes()).unwrap();

    // 1. Token WITHOUT exp field -> allowed because require_exp is false
    let claims_no_exp = serde_json::json!({
        "iss": "https://auth.matrix.local",
        "role": "admin",
        "sub": "user_42",
        "dept": "engineering"
    });
    let token_no_exp = encode(
        &Header::default(),
        &claims_no_exp,
        &EncodingKey::from_secret(secret.as_bytes()),
    ).unwrap();

    let res = engine.evaluate(
        b"api.matrix.local",
        b"/api/resource",
        Some(format!("Bearer {token_no_exp}").as_bytes()),
    ).unwrap();

    match res {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 3);
            assert_eq!(forwarded_headers[0], ("X-User-Role".to_string(), "admin".to_string()));
            assert_eq!(forwarded_headers[1], ("X-User-Id".to_string(), "user_42".to_string()));
            assert_eq!(forwarded_headers[2], ("X-Department".to_string(), "engineering".to_string()));
        }
        _ => panic!("Expected Allow, got {:?}", res),
    }

    // 2. Token with wrong iss -> rejected (401)
    let claims_bad_iss = serde_json::json!({
        "iss": "https://attacker.local",
        "role": "admin",
        "sub": "user_42"
    });
    let token_bad_iss = encode(
        &Header::default(),
        &claims_bad_iss,
        &EncodingKey::from_secret(secret.as_bytes()),
    ).unwrap();
    assert_eq!(
        engine.evaluate(b"api.matrix.local", b"/api/resource", Some(format!("Bearer {token_bad_iss}").as_bytes())).unwrap(),
        JwtDecision::Unauthorized
    );

    // 3. Token with role not matching regex -> rejected (401)
    let claims_bad_role = serde_json::json!({
        "iss": "https://auth.matrix.local",
        "role": "guest",
        "sub": "user_42"
    });
    let token_bad_role = encode(
        &Header::default(),
        &claims_bad_role,
        &EncodingKey::from_secret(secret.as_bytes()),
    ).unwrap();
    assert_eq!(
        engine.evaluate(b"api.matrix.local", b"/api/resource", Some(format!("Bearer {token_bad_role}").as_bytes())).unwrap(),
        JwtDecision::Unauthorized
    );

    // 4. Token missing optional claim (dept) -> allowed, optional header omitted
    let claims_no_dept = serde_json::json!({
        "iss": "https://auth.matrix.local",
        "role": "operator",
        "sub": "user_99"
    });
    let token_no_dept = encode(
        &Header::default(),
        &claims_no_dept,
        &EncodingKey::from_secret(secret.as_bytes()),
    ).unwrap();
    match engine.evaluate(b"api.matrix.local", b"/api/resource", Some(format!("Bearer {token_no_dept}").as_bytes())).unwrap() {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 2);
            assert_eq!(forwarded_headers[0], ("X-User-Role".to_string(), "operator".to_string()));
            assert_eq!(forwarded_headers[1], ("X-User-Id".to_string(), "user_99".to_string()));
        }
        _ => panic!("Expected Allow"),
    }

    // 5. When require_exp is true, token without exp MUST be rejected
    let strict_policy = serde_json::json!({
        "schema_version": 1,
        "generation": 3,
        "origins": [
            {
                "id": "strict-origin",
                "origin": "api.matrix.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "require_exp": true
            }
        ]
    });
    let strict_engine = JwtEngine::from_snapshot(strict_policy.to_string().as_bytes()).unwrap();
    assert_eq!(
        strict_engine.evaluate(b"api.matrix.local", b"/api/resource", Some(format!("Bearer {token_no_exp}").as_bytes())).unwrap(),
        JwtDecision::Unauthorized
    );
}
