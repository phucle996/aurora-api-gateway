use super::engine::JwtEngine;
use super::types::JwtDecision;
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::Serialize;
use std::sync::Arc;

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
      "path_prefix": "/api",
      "token_source": "header",
      "header_name": "Authorization",
      "token_prefix": "Bearer "
    }
  ]
}"#;
    assert!(JwtEngine::from_snapshot(raw).is_ok());
}

#[test]
fn rejects_incomplete_or_private_key_snapshots() {
    assert!(
        JwtEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"origins":[]}"#).is_err()
    );
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
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
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
            forwarded_headers: Arc::from([])
        }
    );

    let bypass_health = engine
        .evaluate(b"api.shop.local", b"/api/healthz", None)
        .unwrap();
    assert_eq!(
        bypass_health,
        JwtDecision::Allow {
            forwarded_headers: Arc::from([])
        }
    );

    // 2. Unmatched origin should bypass
    let other_host = engine
        .evaluate(b"other.shop.local", b"/api/orders", None)
        .unwrap();
    assert_eq!(
        other_host,
        JwtDecision::Allow {
            forwarded_headers: Arc::from([])
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
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
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
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
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
    )
    .unwrap();

    let res = engine
        .evaluate(
            b"api.matrix.local",
            b"/api/resource",
            Some(format!("Bearer {token_no_exp}").as_bytes()),
        )
        .unwrap();

    match res {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 3);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Role".to_string(), "admin".to_string())
            );
            assert_eq!(
                forwarded_headers[1],
                ("X-User-Id".to_string(), "user_42".to_string())
            );
            assert_eq!(
                forwarded_headers[2],
                ("X-Department".to_string(), "engineering".to_string())
            );
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
    )
    .unwrap();
    assert_eq!(
        engine
            .evaluate(
                b"api.matrix.local",
                b"/api/resource",
                Some(format!("Bearer {token_bad_iss}").as_bytes())
            )
            .unwrap(),
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
    )
    .unwrap();
    assert_eq!(
        engine
            .evaluate(
                b"api.matrix.local",
                b"/api/resource",
                Some(format!("Bearer {token_bad_role}").as_bytes())
            )
            .unwrap(),
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
    )
    .unwrap();
    match engine
        .evaluate(
            b"api.matrix.local",
            b"/api/resource",
            Some(format!("Bearer {token_no_dept}").as_bytes()),
        )
        .unwrap()
    {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 2);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Role".to_string(), "operator".to_string())
            );
            assert_eq!(
                forwarded_headers[1],
                ("X-User-Id".to_string(), "user_99".to_string())
            );
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
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "require_exp": true
            }
        ]
    });
    let strict_engine = JwtEngine::from_snapshot(strict_policy.to_string().as_bytes()).unwrap();
    assert_eq!(
        strict_engine
            .evaluate(
                b"api.matrix.local",
                b"/api/resource",
                Some(format!("Bearer {token_no_exp}").as_bytes())
            )
            .unwrap(),
        JwtDecision::Unauthorized
    );
}

const TEST_RSA_PUB: &str = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0zVSlNUkbhLP4B20mKBY\no0Tzu8kujY1X+wsBgPFq8yzMoTdzBRP4/ewg7VV/q2Td/Mg83OQR6GDc88++SgMK\nFpPp1+L75n3mjwOZ7ertWkeaUJy+NzN8s7FyVm6m3X88SC4yDUr8iGUT/qgYd4cs\nkzIEpGJ9/VwopxBWTeCr14NR/7m4362VrJtpBQFav+CfRa/mOBIhQ26oKMUS2HFL\n966W97X+f2L/9pRBd9AhtIpElkpbgEqWTPOl7DZcaAh4lc66x/bWwcZdsrmWAAWt\nRPq2IMoSAdv1IkYHXhqG+1cAnsqjlnJvf4D+KNCgVSkAuqDgAT++XVI90cwlEVd4\nmQIDAQAB\n-----END PUBLIC KEY-----\n";
const TEST_RSA_PRIV: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDTNVKU1SRuEs/g\nHbSYoFijRPO7yS6NjVf7CwGA8WrzLMyhN3MFE/j97CDtVX+rZN38yDzc5BHoYNzz\nz75KAwoWk+nX4vvmfeaPA5nt6u1aR5pQnL43M3yzsXJWbqbdfzxILjINSvyIZRP+\nqBh3hyyTMgSkYn39XCinEFZN4KvXg1H/ubjfrZWsm2kFAVq/4J9Fr+Y4EiFDbqgo\nxRLYcUv3rpb3tf5/Yv/2lEF30CG0ikSWSluASpZM86XsNlxoCHiVzrrH9tbBxl2y\nuZYABa1E+rYgyhIB2/UiRgdeGob7VwCeyqOWcm9/gP4o0KBVKQC6oOABP75dUj3R\nzCURV3iZAgMBAAECggEAHTcCv4oVEjHBddl+Dd+eKyViRn8vVI6w1Q2ibVzXg6AW\nhRVXsGPhHPSQ4Gtjb8iRyUHEY3SbwoZFgeciRfgSKOnYXo+r8ufG4NDpdaa5orOF\nVbG8wQN69BsvOuPu6nQLWVukekC9WjuLDr5fNgdpY8n3KOrjzQw2pldE7NxPQM3N\nndFLugMY9fmYCCuOcj8K75+PrMAOUwvuT9i1EbTnVNC0FOS2Cf/+PU1DxNsqPqDp\now2TbYPILp1TM8pFGZmk3vcnHmcCfLFRtTF5T2IfKA3g0vTS9NMQL5TxXszb0I1i\nbdv0RUISBNcTbSyMJD2wzIjSUbEHSyC4/MwyfmJsBQKBgQD7r4C5LsoTgjUmmZng\nnrK7yTxoSbpUvTraf3EhiYQ80xYAJkovW7oDAtxlbtgvvTSW36E0E3kQfJriAHE8\n6Af78jkEO70y16+kRO0aoDD+A9SnC9/JAh9M3V1lfvfE73KPsqIh3jaad8KrM8c3\nJW6MsYq7/7H6GAlEYRd/MlFqXQKBgQDW1DB0fR+L/bHHf69UaCyXbMOZe/OWlV+9\nxM35z5Y9/lZbFp1AcCdMK5G0pr7iTlY29Z9KtUEidJMV4itW+wdCFoM/veNbY53j\nskLDi4Fj9JUxUeikhQjs5tThRurTdXCPW6bh/zf9pDeMsXlYG34E5+iSrVcYVCq7\nw6BXqLT7bQKBgQCkTFc9i/vCbHeB8TdwWGjZCW7zrV2Dv9vRkuwpNnoqsqlkA5rd\n+4UcPhvd41QhJeRUsTusoSGgz5bT/fHuDpJXuDHcP5ssu3wfQhd+ECCrUZjaS3gU\n4dvI86Dqhs37s0wX3kbU0RjYEWH1HOHpb/gQxD2KqEpotpQmHTOXhyN6yQKBgHCB\nu8al6KmV+U7zjcz0qbW73kw5X/6SyAtIUF7t2k8pLeySUVR35/y6LJqhYQJ/6CLs\nS7oCZtQ2nPku82egG9L+m0n8ll88MmoW52QlYWQJqUClFuNiUKRQ11gLnduUe5h4\ndVOSJ66MHBNwto3wB/VlxqVaZmx1V9Pxxb1iuzWZAoGAD7cy/mMSRNbkcAcpYy6d\nj7Au9rDs4QbalGMb496V9TK7UI6y9GCxi0DsD8Ioq00+aXP12J5uT3yMmbK59L0r\nmjmhNbcQleQNu4DRbjgbr/zsUYyUJb6RKWrh5/cd8BST5uPmIq2EQ/XmsYlQM7hQ\nJ6OGrHJqZu8i9hU6YMjKQUM=\n-----END PRIVATE KEY-----\n";

#[test]
fn test_asymmetric_rs256_verification() {
    use jsonwebtoken::{Algorithm, Header};

    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 100,
        "origins": [
            {
                "id": "rsa-origin",
                "origin": "api.rsa.local",
                "path_prefix": "/api",
                "algorithm": "RS256",
                "public_key_pem": TEST_RSA_PUB,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "claim_rules": [
                    { "payload_key": "sub", "values_match": "*", "header_key": "X-User-Id", "required": true }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    let claims = serde_json::json!({
        "sub": "user_rsa",
        "exp": 2_000_000_000
    });
    let token = encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &EncodingKey::from_rsa_pem(TEST_RSA_PRIV.as_bytes()).unwrap(),
    )
    .unwrap();

    let res = engine
        .evaluate(
            b"api.rsa.local",
            b"/api/test",
            Some(format!("Bearer {token}").as_bytes()),
        )
        .unwrap();

    match res {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 1);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Id".to_string(), "user_rsa".to_string())
            );
        }
        _ => panic!("Expected Allow, got {:?}", res),
    }
}

#[test]
fn test_nested_claims_and_array_flattening() {
    let secret = "nested-claims-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 101,
        "origins": [
            {
                "id": "nested-origin",
                "origin": "api.nested.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "claim_rules": [
                    { "payload_key": "user.profile.id", "values_match": "*", "header_key": "X-User-Id", "required": true },
                    { "payload_key": "user.profile.tier", "values_match": "^(gold|platinum)$", "header_key": "X-Tier", "required": true },
                    { "payload_key": "roles", "values_match": "*", "header_key": "X-Roles", "required": true },
                    { "payload_key": "groups", "values_match": "*", "header_key": "X-Groups", "required": false }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    let claims = serde_json::json!({
        "user": {
            "profile": {
                "id": "usr_nested_99",
                "tier": "gold"
            }
        },
        "roles": ["admin", "developer", "maintainer"],
        "groups": [101, 202],
        "exp": 2_000_000_000
    });

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();

    let res = engine
        .evaluate(
            b"api.nested.local",
            b"/api/nested-test",
            Some(format!("Bearer {token}").as_bytes()),
        )
        .unwrap();

    match res {
        JwtDecision::Allow { forwarded_headers } => {
            assert_eq!(forwarded_headers.len(), 4);
            assert_eq!(
                forwarded_headers[0],
                ("X-User-Id".to_string(), "usr_nested_99".to_string())
            );
            assert_eq!(
                forwarded_headers[1],
                ("X-Tier".to_string(), "gold".to_string())
            );
            assert_eq!(
                forwarded_headers[2],
                (
                    "X-Roles".to_string(),
                    "admin, developer, maintainer".to_string()
                )
            );
            assert_eq!(
                forwarded_headers[3],
                ("X-Groups".to_string(), "101, 202".to_string())
            );
        }
        _ => panic!("Expected Allow with flattened nested claims, got {:?}", res),
    }
}

#[test]
fn test_positive_cache_hit_and_expiration() {
    let secret = "cache-test-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 102,
        "origins": [
            {
                "id": "cache-origin",
                "origin": "api.cache.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "cache": {
                    "enabled": true,
                    "shards": 16,
                    "max_entries_per_shard": 128,
                    "default_ttl_secs": 100,
                    "negative_ttl_secs": 30
                },
                "claim_rules": [
                    { "payload_key": "sub", "values_match": "*", "header_key": "X-User-Id", "required": true }
                ]
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    let claims = serde_json::json!({
        "sub": "user_cached_01",
        "exp": 1_000_050 // Expires at t = 1000050
    });
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let auth = format!("Bearer {token}");

    // 1. First evaluation at t = 1000000: Cache Miss -> Cryptographic Verification -> Cache Ingestion
    let res1 = engine
        .evaluate_at(
            b"api.cache.local",
            b"/api/orders",
            Some(auth.as_bytes()),
            1_000_000,
        )
        .unwrap();
    assert!(matches!(res1, JwtDecision::Allow { .. }));

    // 2. Second evaluation at t = 1000010: Cache Hit -> Resolves in ~15-20ns without crypto
    let res2 = engine
        .evaluate_at(
            b"api.cache.local",
            b"/api/orders",
            Some(auth.as_bytes()),
            1_000_010,
        )
        .unwrap();
    assert_eq!(res1, res2);

    // 3. Third evaluation at t = 1000060 (past exp timestamp): Expired -> Cache misses expired entry -> Crypto re-eval rejects
    let res3 = engine
        .evaluate_at(
            b"api.cache.local",
            b"/api/orders",
            Some(auth.as_bytes()),
            1_000_060,
        )
        .unwrap();
    assert_eq!(res3, JwtDecision::Unauthorized);
}

#[test]
fn test_negative_cache_and_antidos() {
    let secret = "antidos-test-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 103,
        "origins": [
            {
                "id": "antidos-origin",
                "origin": "api.antidos.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "cache": {
                    "enabled": true,
                    "default_ttl_secs": 60,
                    "negative_ttl_secs": 10
                }
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // Fabricate a corrupt token
    let bad_auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.corrupted_bad_sig_xxxxxxxxxxxxxxxxxxxxxxxxxxx";

    // 1. Initial rejection: Crypto check fails and records token hash in negative cache
    let r1 = engine
        .evaluate_at(
            b"api.antidos.local",
            b"/api/data",
            Some(bad_auth.as_bytes()),
            2_000_000,
        )
        .unwrap();
    assert_eq!(r1, JwtDecision::Unauthorized);

    // 2. Subsequent flood at t = 2000005: Instant rejection via negative cache without running any crypto
    let r2 = engine
        .evaluate_at(
            b"api.antidos.local",
            b"/api/data",
            Some(bad_auth.as_bytes()),
            2_000_005,
        )
        .unwrap();
    assert_eq!(r2, JwtDecision::Unauthorized);
}

#[test]
fn test_fail_fast_malformed_signature_length() {
    let secret = "siglen-test-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 104,
        "origins": [
            {
                "id": "siglen-origin",
                "origin": "api.siglen.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer "
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // HS256 requires exactly 43 chars base64url signature. Provide 10 chars.
    let malformed =
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.shortsig";
    let res = engine
        .evaluate(
            b"api.siglen.local",
            b"/api/data",
            Some(malformed.as_bytes()),
        )
        .unwrap();
    assert_eq!(res, JwtDecision::Unauthorized);
}

#[test]
fn test_nbf_future_token_rejected() {
    let secret = "nbf-test-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 105,
        "origins": [
            {
                "id": "nbf-origin",
                "origin": "api.nbf.local",
                "path_prefix": "/api",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer ",
                "validate_nbf": true,
                "clock_skew_secs": 10
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // nbf is set to 3000050, current time is 3000000
    let claims = serde_json::json!({
        "sub": "user_future",
        "nbf": 3_000_050,
        "exp": 4_000_000
    });
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();

    let res = engine
        .evaluate_at(
            b"api.nbf.local",
            b"/api/data",
            Some(format!("Bearer {token}").as_bytes()),
            3_000_000,
        )
        .unwrap();
    assert_eq!(res, JwtDecision::Unauthorized);
}

#[test]
fn test_branchless_bearer_prefix_and_whitespace() {
    use super::engine::is_bearer_authorization;

    // Positive cases (any case of "Bearer " + at least 1 byte)
    assert!(is_bearer_authorization(b"Bearer abc"));
    assert!(is_bearer_authorization(b"bearer abc"));
    assert!(is_bearer_authorization(b"BEARER abc"));
    assert!(is_bearer_authorization(b"bEaReR abc"));

    // Negative cases
    assert!(!is_bearer_authorization(b""));
    assert!(!is_bearer_authorization(b"Bearer"));
    assert!(!is_bearer_authorization(b"Bearer ")); // len <= 7
    assert!(!is_bearer_authorization(b"Basic abc"));
    assert!(!is_bearer_authorization(b"Bearer\tabc"));
    assert!(!is_bearer_authorization(b"Bearertoken"));

    // Overlong (> 16384)
    let overlong = vec![b'a'; 16385];
    assert!(!is_bearer_authorization(&overlong));
}

#[test]
fn test_swar_algorithm_matching() {
    use super::crypto::{JwtAlgorithm, matches_algorithm};

    // All 9 algorithms match themselves case-insensitively
    let algs = [
        (JwtAlgorithm::HS256, "HS256"),
        (JwtAlgorithm::HS384, "HS384"),
        (JwtAlgorithm::HS512, "HS512"),
        (JwtAlgorithm::RS256, "RS256"),
        (JwtAlgorithm::RS384, "RS384"),
        (JwtAlgorithm::RS512, "RS512"),
        (JwtAlgorithm::ES256, "ES256"),
        (JwtAlgorithm::ES384, "ES384"),
        (JwtAlgorithm::EdDSA, "EdDSA"),
    ];

    for (alg, name) in algs {
        assert!(matches_algorithm(name, alg));
        assert!(matches_algorithm(&name.to_lowercase(), alg));
        assert!(matches_algorithm(&name.to_uppercase(), alg));
    }

    // Cross-algorithm mismatches
    assert!(!matches_algorithm("HS384", JwtAlgorithm::HS256));
    assert!(!matches_algorithm("RS256", JwtAlgorithm::ES256));

    // Length mismatches & invalid inputs
    assert!(!matches_algorithm("HS25", JwtAlgorithm::HS256));
    assert!(!matches_algorithm("HS2560", JwtAlgorithm::HS256));
    assert!(!matches_algorithm("none", JwtAlgorithm::HS256));
    assert!(!matches_algorithm("", JwtAlgorithm::HS256));
}

#[test]
fn test_branchless_exclude_boundary_guard() {
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 106,
        "origins": [
            {
                "id": "boundary-origin",
                "origin": "api.test.local",
                "path_prefix": "/api",
                "exclude_paths": ["/api/login", "/api/healthz"],
                "algorithm": "HS256",
                "secret": "test-boundary-secret-key-12345",
                "token_source": "header",
                "header_name": "Authorization",
                "token_prefix": "Bearer "
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    // Exact match bypasses
    assert!(matches!(
        engine
            .evaluate(b"api.test.local", b"/api/login", None)
            .unwrap(),
        JwtDecision::Allow { .. }
    ));
    assert!(matches!(
        engine
            .evaluate(b"api.test.local", b"/api/healthz", None)
            .unwrap(),
        JwtDecision::Allow { .. }
    ));

    // Subpath match bypasses
    assert!(matches!(
        engine
            .evaluate(b"api.test.local", b"/api/login/callback", None)
            .unwrap(),
        JwtDecision::Allow { .. }
    ));

    // Colliding prefix does NOT bypass (boundary guard works correctly)
    assert_eq!(
        engine
            .evaluate(b"api.test.local", b"/api/login_failed", None)
            .unwrap(),
        JwtDecision::Unauthorized
    );
    assert_eq!(
        engine
            .evaluate(b"api.test.local", b"/api/logins", None)
            .unwrap(),
        JwtDecision::Unauthorized
    );
}

#[test]
fn test_cookie_parser_zero_allocation() {
    use super::engine::extract_cookie_value;

    let cookie = b"session=123; access_token=target_jwt_token; theme=dark";
    assert_eq!(
        extract_cookie_value(cookie, b"access_token"),
        Some(b"target_jwt_token".as_slice())
    );
    assert_eq!(
        extract_cookie_value(cookie, b"session"),
        Some(b"123".as_slice())
    );
    assert_eq!(
        extract_cookie_value(cookie, b"theme"),
        Some(b"dark".as_slice())
    );
    assert_eq!(extract_cookie_value(cookie, b"missing"), None);

    // Collision check: access_token_other must not match access_token
    let collision = b"access_token_other=false; access_token=real_token";
    assert_eq!(
        extract_cookie_value(collision, b"access_token"),
        Some(b"real_token".as_slice())
    );

    // Quoted value check
    let quoted = b"access_token=\"quoted_jwt_token\"; foo=bar";
    assert_eq!(
        extract_cookie_value(quoted, b"access_token"),
        Some(b"quoted_jwt_token".as_slice())
    );

    // Leading/trailing whitespace
    let spaces = b"   access_token=token_val   ; other=xyz ";
    assert_eq!(
        extract_cookie_value(spaces, b"access_token"),
        Some(b"token_val".as_slice())
    );
}

#[test]
fn test_jwt_token_sources_and_strict_no_fallback() {
    let secret = "token-source-secret-123456789";
    let policy_json = serde_json::json!({
        "schema_version": 1,
        "generation": 107,
        "origins": [
            {
                "id": "hdr-origin",
                "origin": "api.test.local",
                "path_prefix": "/custom-header",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "header",
                "header_name": "X-Auth-Token",
                "token_prefix": ""
            },
            {
                "id": "cookie-origin",
                "origin": "api.test.local",
                "path_prefix": "/cookie",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": "cookie",
                "cookie_name": "session_id"
            },
            {
                "id": "obj-origin",
                "origin": "api.test.local",
                "path_prefix": "/obj-cookie",
                "algorithm": "HS256",
                "secret": secret,
                "token_source": { "type": "cookie", "name": "app_jwt" }
            }
        ]
    });

    let engine = JwtEngine::from_snapshot(policy_json.to_string().as_bytes()).unwrap();

    let claims = serde_json::json!({ "sub": "test_user", "exp": 4_000_000_000u64 });
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap();
    let bearer_auth = format!("Bearer {token}");

    // 1. Header origin: X-Auth-Token succeeds; Authorization fails (strictly NO fallback)
    let ok_hdr = engine
        .evaluate_with_lookup(b"api.test.local", b"/custom-header", |n| {
            (n.eq_ignore_ascii_case("X-Auth-Token")).then_some(token.as_bytes())
        })
        .unwrap();
    assert!(matches!(ok_hdr, JwtDecision::Allow { .. }));

    let no_fallback_hdr = engine
        .evaluate_with_lookup(b"api.test.local", b"/custom-header", |n| {
            (n.eq_ignore_ascii_case("Authorization")).then_some(bearer_auth.as_bytes())
        })
        .unwrap();
    assert_eq!(no_fallback_hdr, JwtDecision::Unauthorized);

    // 2. Cookie origin: session_id succeeds; wrong cookie or Authorization fails (strictly NO fallback)
    let cookie_val = format!("theme=dark; session_id={token}; other=123");
    let ok_cookie = engine
        .evaluate_with_lookup(b"api.test.local", b"/cookie", |n| {
            (n.eq_ignore_ascii_case("cookie")).then_some(cookie_val.as_bytes())
        })
        .unwrap();
    assert!(matches!(ok_cookie, JwtDecision::Allow { .. }));

    let wrong_cookie = format!("access_token={token}");
    let bad_cookie = engine
        .evaluate_with_lookup(b"api.test.local", b"/cookie", |n| {
            (n.eq_ignore_ascii_case("cookie")).then_some(wrong_cookie.as_bytes())
        })
        .unwrap();
    assert_eq!(bad_cookie, JwtDecision::Unauthorized);

    let no_fallback_cookie = engine
        .evaluate_with_lookup(b"api.test.local", b"/cookie", |n| {
            (n.eq_ignore_ascii_case("Authorization")).then_some(bearer_auth.as_bytes())
        })
        .unwrap();
    assert_eq!(no_fallback_cookie, JwtDecision::Unauthorized);

    // 3. Object-style cookie origin succeeds
    let obj_cookie = format!("app_jwt={token}");
    let ok_obj = engine
        .evaluate_with_lookup(b"api.test.local", b"/obj-cookie", |n| {
            (n.eq_ignore_ascii_case("cookie")).then_some(obj_cookie.as_bytes())
        })
        .unwrap();
    assert!(matches!(ok_obj, JwtDecision::Allow { .. }));
}

#[test]
fn test_jwt_token_source_strict_validation_no_fallback() {
    let bad_origins = [
        serde_json::json!({ "id": "o1", "origin": "*", "algorithm": "HS256", "secret": "s", "token_source": "header" }),
        serde_json::json!({ "id": "o2", "origin": "*", "algorithm": "HS256", "secret": "s", "token_source": "cookie" }),
        serde_json::json!({ "id": "o3", "origin": "*", "algorithm": "HS256", "secret": "s", "token_source": "header", "header_name": "X-T", "cookie_name": "c" }),
        serde_json::json!({ "id": "o4", "origin": "*", "algorithm": "HS256", "secret": "s", "token_source": "cookie", "cookie_name": "c", "header_name": "X-T" }),
        serde_json::json!({ "id": "o5", "origin": "*", "algorithm": "HS256", "secret": "s", "header_name": "X-T" }),
        serde_json::json!({ "id": "o6", "origin": "*", "algorithm": "HS256", "secret": "s", "cookie_name": "c" }),
        serde_json::json!({ "id": "o7", "origin": "*", "algorithm": "HS256", "secret": "s", "token_source": "query" }),
    ];

    for (idx, origin) in bad_origins.into_iter().enumerate() {
        let snap =
            serde_json::json!({ "schema_version": 1, "generation": idx + 1, "origins": [origin] });
        assert!(JwtEngine::from_snapshot(snap.to_string().as_bytes()).is_err());
    }
}
