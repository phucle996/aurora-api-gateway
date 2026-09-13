//! Run with `cargo bench -p aurora-engine --bench jwt_evaluate`.
//! Single-thread engine microbenchmarks measuring nanoseconds and allocations per evaluation.
use aurora_engine::jwt::{JwtDecision, JwtEngine};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::Serialize;
use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct CountedAllocator;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountedAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountedAllocator = CountedAllocator;

#[derive(Serialize)]
struct BenchClaims {
    sub: String,
    role: String,
    tenant_id: String,
    exp: u64,
}

const RSA_PUB: &str = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0zVSlNUkbhLP4B20mKBY\no0Tzu8kujY1X+wsBgPFq8yzMoTdzBRP4/ewg7VV/q2Td/Mg83OQR6GDc88++SgMK\nFpPp1+L75n3mjwOZ7ertWkeaUJy+NzN8s7FyVm6m3X88SC4yDUr8iGUT/qgYd4cs\nkzIEpGJ9/VwopxBWTeCr14NR/7m4362VrJtpBQFav+CfRa/mOBIhQ26oKMUS2HFL\n966W97X+f2L/9pRBd9AhtIpElkpbgEqWTPOl7DZcaAh4lc66x/bWwcZdsrmWAAWt\nRPq2IMoSAdv1IkYHXhqG+1cAnsqjlnJvf4D+KNCgVSkAuqDgAT++XVI90cwlEVd4\nmQIDAQAB\n-----END PUBLIC KEY-----\n";
const RSA_PRIV: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDTNVKU1SRuEs/g\nHbSYoFijRPO7yS6NjVf7CwGA8WrzLMyhN3MFE/j97CDtVX+rZN38yDzc5BHoYNzz\nz75KAwoWk+nX4vvmfeaPA5nt6u1aR5pQnL43M3yzsXJWbqbdfzxILjINSvyIZRP+\nqBh3hyyTMgSkYn39XCinEFZN4KvXg1H/ubjfrZWsm2kFAVq/4J9Fr+Y4EiFDbqgo\nxRLYcUv3rpb3tf5/Yv/2lEF30CG0ikSWSluASpZM86XsNlxoCHiVzrrH9tbBxl2y\nuZYABa1E+rYgyhIB2/UiRgdeGob7VwCeyqOWcm9/gP4o0KBVKQC6oOABP75dUj3R\nzCURV3iZAgMBAAECggEAHTcCv4oVEjHBddl+Dd+eKyViRn8vVI6w1Q2ibVzXg6AW\nhRVXsGPhHPSQ4Gtjb8iRyUHEY3SbwoZFgeciRfgSKOnYXo+r8ufG4NDpdaa5orOF\nVbG8wQN69BsvOuPu6nQLWVukekC9WjuLDr5fNgdpY8n3KOrjzQw2pldE7NxPQM3N\nndFLugMY9fmYCCuOcj8K75+PrMAOUwvuT9i1EbTnVNC0FOS2Cf/+PU1DxNsqPqDp\now2TbYPILp1TM8pFGZmk3vcnHmcCfLFRtTF5T2IfKA3g0vTS9NMQL5TxXszb0I1i\nbdv0RUISBNcTbSyMJD2wzIjSUbEHSyC4/MwyfmJsBQKBgQD7r4C5LsoTgjUmmZng\nnrK7yTxoSbpUvTraf3EhiYQ80xYAJkovW7oDAtxlbtgvvTSW36E0E3kQfJriAHE8\n6Af78jkEO70y16+kRO0aoDD+A9SnC9/JAh9M3V1lfvfE73KPsqIh3jaad8KrM8c3\nJW6MsYq7/7H6GAlEYRd/MlFqXQKBgQDW1DB0fR+L/bHHf69UaCyXbMOZe/OWlV+9\nxM35z5Y9/lZbFp1AcCdMK5G0pr7iTlY29Z9KtUEidJMV4itW+wdCFoM/veNbY53j\nskLDi4Fj9JUxUeikhQjs5tThRurTdXCPW6bh/zf9pDeMsXlYG34E5+iSrVcYVCq7\nw6BXqLT7bQKBgQCkTFc9i/vCbHeB8TdwWGjZCW7zrV2Dv9vRkuwpNnoqsqlkA5rd\n+4UcPhvd41QhJeRUsTusoSGgz5bT/fHuDpJXuDHcP5ssu3wfQhd+ECCrUZjaS3gU\n4dvI86Dqhs37s0wX3kbU0RjYEWH1HOHpb/gQxD2KqEpotpQmHTOXhyN6yQKBgHCB\nu8al6KmV+U7zjcz0qbW73kw5X/6SyAtIUF7t2k8pLeySUVR35/y6LJqhYQJ/6CLs\nS7oCZtQ2nPku82egG9L+m0n8ll88MmoW52QlYWQJqUClFuNiUKRQ11gLnduUe5h4\ndVOSJ66MHBNwto3wB/VlxqVaZmx1V9Pxxb1iuzWZAoGAD7cy/mMSRNbkcAcpYy6d\nj7Au9rDs4QbalGMb496V9TK7UI6y9GCxi0DsD8Ioq00+aXP12J5uT3yMmbK59L0r\nmjmhNbcQleQNu4DRbjgbr/zsUYyUJb6RKWrh5/cd8BST5uPmIq2EQ/XmsYlQM7hQ\nJ6OGrHJqZu8i9hU6YMjKQUM=\n-----END PRIVATE KEY-----\n";

const EC_PUB: &str = "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtSfg96VSp3mLb/WguwsaTO4DKgGw\nbhsXEokzyoBPPN3I3wiQyal2Y5HcPEmpMLl6bjcP1/OyaVdr8VenPyF1Gg==\n-----END PUBLIC KEY-----\n";
const EC_PRIV: &str = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgL5ACrJygIg/TIq9P\nIAKQjBymLuMY/uddOm63CDWkNTKhRANCAAS1J+D3pVKneYtv9aC7CxpM7gMqAbBu\nGxcSiTPKgE883cjfCJDJqXZjkdw8SakwuXpuNw/X87JpV2vxV6c/IXUa\n-----END PRIVATE KEY-----\n";

const ED_PUB: &str = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAI45UG9GBqAYw1G05lo/I23HNP2JheWxrvBMpcNuHUYc=\n-----END PUBLIC KEY-----\n";
const ED_PRIV: &str = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBoG/4ex6SGyU6JXYdU9jcetwbdWw+Tw9RF72zpVdVse\n-----END PRIVATE KEY-----\n";

fn main() {
    let require_zero = std::env::args().any(|arg| arg == "--assert-zero-warm-allocations");
    println!("algorithm,scenario,rules,median_ns_per_eval,allocations_per_eval");

    let hmac_secret = "super-secret-hmac-shared-key-for-jwt-benchmarks!";

    // Prepare test claims
    let claims = BenchClaims {
        sub: "usr_bench_42".to_string(),
        role: "admin".to_string(),
        tenant_id: "T-1000".to_string(),
        exp: 2_000_000_000,
    };

    // Pre-encode tokens for all 4 algorithms
    let hs_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(hmac_secret.as_bytes()),
    )
    .unwrap();
    let hs_auth = format!("Bearer {hs_token}");

    let rs_token = encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &EncodingKey::from_rsa_pem(RSA_PRIV.as_bytes()).unwrap(),
    )
    .unwrap();
    let rs_auth = format!("Bearer {rs_token}");

    let es_token = encode(
        &Header::new(Algorithm::ES256),
        &claims,
        &EncodingKey::from_ec_pem(EC_PRIV.as_bytes()).unwrap(),
    )
    .unwrap();
    let es_auth = format!("Bearer {es_token}");

    let ed_token = encode(
        &Header::new(Algorithm::EdDSA),
        &claims,
        &EncodingKey::from_ed_pem(ED_PRIV.as_bytes()).unwrap(),
    )
    .unwrap();
    let ed_auth = format!("Bearer {ed_token}");

    let bad_auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUPv_dummy";

    let configurations = [
        // (alg, scenario, rule_count, iterations, auth_header, path, expected_allow)
        (
            "HS256",
            "warm_valid",
            1,
            50_000,
            Some(hs_auth.as_bytes()),
            b"/api/orders".as_slice(),
            true,
        ),
        (
            "HS256",
            "exclude_path",
            1,
            50_000,
            None,
            b"/api/healthz".as_slice(),
            true,
        ),
        (
            "HS256",
            "no_token",
            1,
            50_000,
            None,
            b"/api/orders".as_slice(),
            false,
        ),
        (
            "HS256",
            "bad_signature",
            1,
            50_000,
            Some(bad_auth.as_bytes()),
            b"/api/orders".as_slice(),
            false,
        ),
        (
            "HS256",
            "multi_rules_16",
            16,
            50_000,
            Some(hs_auth.as_bytes()),
            b"/api/orders".as_slice(),
            true,
        ),
        (
            "RS256",
            "warm_valid",
            1,
            5_000,
            Some(rs_auth.as_bytes()),
            b"/api/orders".as_slice(),
            true,
        ),
        (
            "ES256",
            "warm_valid",
            1,
            5_000,
            Some(es_auth.as_bytes()),
            b"/api/orders".as_slice(),
            true,
        ),
        (
            "EdDSA",
            "warm_valid",
            1,
            5_000,
            Some(ed_auth.as_bytes()),
            b"/api/orders".as_slice(),
            true,
        ),
    ];

    for (alg, scenario, rule_count, iterations, auth_hdr, req_path, expected_allow) in
        configurations
    {
        let rules: Vec<_> = (0..rule_count)
            .map(|idx| {
                let mut origin = serde_json::json!({
                    "id": format!("origin-{idx:02}"),
                    "host": if idx == 0 { "*" } else { "api.other.local" },
                    "path_prefix": "/api",
                    "exclude_paths": ["/api/healthz", "/api/public"],
                    "algorithm": alg,
                    "claim_rules": [
                        { "payload_key": "sub", "values_match": "*", "header_key": "X-User-Id", "required": true },
                        { "payload_key": "role", "values_match": "^(admin|operator)$", "header_key": "X-User-Role", "required": true }
                    ]
                });
                match alg {
                    "HS256" => origin["secret"] = serde_json::Value::String(hmac_secret.to_string()),
                    "RS256" => origin["public_key_pem"] = serde_json::Value::String(RSA_PUB.to_string()),
                    "ES256" => origin["public_key_pem"] = serde_json::Value::String(EC_PUB.to_string()),
                    "EdDSA" => origin["public_key_pem"] = serde_json::Value::String(ED_PUB.to_string()),
                    _ => unreachable!(),
                }
                origin
            })
            .collect();

        let policy_bytes = serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "generation": 1,
            "rules": rules
        }))
        .unwrap();

        let engine = JwtEngine::from_snapshot(&policy_bytes).unwrap();

        // Warm-up iteration
        let initial = engine.evaluate(b"example.com", req_path, auth_hdr).unwrap();
        assert_eq!(
            matches!(initial, JwtDecision::Allow { .. }),
            expected_allow,
            "Warm-up assertion mismatch for {alg}/{scenario}"
        );

        let mut samples = [0.0_f64; 7];
        let mut allocation_count = 0;

        for sample in &mut samples {
            let before = ALLOCATIONS.load(Ordering::Relaxed);
            let start = Instant::now();
            for _ in 0..iterations {
                let decision = engine
                    .evaluate(
                        black_box(b"example.com"),
                        black_box(req_path),
                        black_box(auth_hdr),
                    )
                    .unwrap();
                black_box(decision);
            }
            *sample = start.elapsed().as_nanos() as f64 / iterations as f64;
            allocation_count += ALLOCATIONS.load(Ordering::Relaxed) - before;
        }

        samples.sort_by(f64::total_cmp);
        let median_ns = samples[samples.len() / 2];
        let alloc_per_eval = allocation_count as f64 / (iterations * samples.len()) as f64;

        if require_zero && (scenario == "exclude_path" || scenario == "no_token") {
            assert_eq!(
                allocation_count, 0,
                "{alg}/{scenario} expected 0 allocations"
            );
        }

        println!("{alg},{scenario},{rule_count},{median_ns:.1},{alloc_per_eval:.3}");
    }
}
