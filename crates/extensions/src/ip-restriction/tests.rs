use super::engine::IpRestrictionEngine;
use super::policy::IpRestrictionRequest;

#[test]
fn test_ipv4_exact_and_subnet_matching() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 10,
        "rules": [
            {
                "id": 1,
                "priority": 10,
                "action": "block",
                "networks": ["192.168.1.0/24"],
                "path_prefix": "/admin"
            },
            {
                "id": 2,
                "priority": 5,
                "action": "allow",
                "networks": ["192.168.1.50/32"],
                "path_prefix": "/admin"
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).expect("valid snapshot");

    // 192.168.1.50 matches rule 2 (priority 5 - allow) even though it is within 192.168.1.0/24 (priority 10 - block)
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.1.50",
            host: b"example.com",
            path: b"/admin/dashboard",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 0); // allow
    assert_eq!(res.rule_id, 2);

    // 192.168.1.51 matches rule 1 (block)
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.1.51",
            host: b"example.com",
            path: b"/admin/dashboard",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.action, 1); // block
    assert_eq!(res2.rule_id, 1);

    // 192.168.2.1 outside 192.168.1.0/24 -> default allow
    let res3 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.2.1",
            host: b"example.com",
            path: b"/admin/dashboard",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res3.action, 0);
    assert_eq!(res3.rule_id, 0);
}

#[test]
fn test_ipv4_mapped_ipv6_handling() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 1,
                "action": "block",
                "networks": ["10.0.0.0/8"]
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    // Client connects via IPv4-mapped IPv6 ::ffff:10.5.5.5 -> should be unmapped and blocked
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"::ffff:10.5.5.5",
            host: b"api.internal",
            path: b"/",
            method: b"POST",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 1);
    assert_eq!(res.rule_id, 1);
}

#[test]
fn test_ipv6_subnet_matching() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 2,
        "rules": [
            {
                "id": 100,
                "priority": 1,
                "action": "block",
                "networks": ["2001:db8::/32"],
                "path_prefix": "/"
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:db8::1234",
            host: b"example.com",
            path: b"/test",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 1);
    assert_eq!(res.rule_id, 100);

    let res_outside = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:cafe::1",
            host: b"example.com",
            path: b"/test",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res_outside.action, 0);
}

#[test]
fn test_longest_prefix_match_tie_breaking() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 10,
                "action": "allow",
                "networks": ["172.16.0.0/16"]
            },
            {
                "id": 2,
                "priority": 10,
                "action": "block",
                "networks": ["172.16.50.0/24"]
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    // 172.16.50.5 matches both /16 (allow) and /24 (block) at equal priority 10.
    // Longest Prefix Match (/24) must prevail -> Block!
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"172.16.50.5",
            host: b"*",
            path: b"/",
            method: b"*",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.rule_id, 2);
    assert_eq!(res.action, 1); // block

    // 172.16.1.1 matches only /16 -> Allow
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"172.16.1.1",
            host: b"*",
            path: b"/",
            method: b"*",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.rule_id, 1);
    assert_eq!(res2.action, 0);
}

#[test]
fn test_reject_ipv4_mapped_ipv6_in_snapshot() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 1,
                "action": "block",
                "networks": ["::ffff:192.168.1.1/128"]
            }
        ]
    }"#;

    assert!(IpRestrictionEngine::from_snapshot(raw).is_err());
}

#[test]
fn test_reject_ipv4_mapped_ipv6_in_declarative_snapshot() {
    let raw = br#"{
        "whitelist": ["::ffff:192.0.2.1/128"],
        "blacklist": [],
        "rules": []
    }"#;

    assert!(IpRestrictionEngine::from_snapshot(raw).is_err());
}

#[test]
fn test_method_and_path_filtering() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 10,
                "priority": 1,
                "action": "block",
                "networks": ["192.168.10.0/24"],
                "path_prefix": "/secure",
                "method": "POST"
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    // 192.168.10.5 calling POST /secure -> Block!
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.10.5",
            host: b"*",
            path: b"/secure/upload",
            method: b"POST",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 1);
    assert_eq!(res.rule_id, 10);

    // 192.168.10.5 calling GET /secure -> Not matching method -> Allow!
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.10.5",
            host: b"*",
            path: b"/secure/upload",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.action, 0);

    // 192.168.10.5 calling POST /other -> Not matching path -> Allow!
    let res3 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.10.5",
            host: b"*",
            path: b"/other",
            method: b"POST",
            now: 0,
        })
        .unwrap();
    assert_eq!(res3.action, 0);
}

#[test]
fn test_declarative_whitelist_and_blacklist_combination() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 5,
        "whitelist": ["10.10.10.50/32"],
        "blacklist": ["10.10.10.0/24"]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    // 10.10.10.50 is on Whitelist (priority 10) -> Allow!
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.10.10.50",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 0);

    // 10.10.10.51 is in Blacklist (priority 20) -> Block!
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.10.10.51",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.action, 1);

    // 10.20.0.1 is outside both -> Default Allow!
    let res3 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.20.0.1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res3.action, 0);
}

#[test]
fn test_numerical_matcher_branch_and_bound_partitioning() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 10,
                "action": "block",
                "networks": ["10.0.0.0/8"]
            },
            {
                "id": 2,
                "priority": 5,
                "action": "allow",
                "networks": ["10.1.0.0/16"]
            },
            {
                "id": 3,
                "priority": 2,
                "action": "block",
                "networks": ["10.1.2.0/24"]
            },
            {
                "id": 4,
                "priority": 1,
                "action": "allow",
                "networks": ["10.1.2.99/32"]
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();
    assert_eq!(engine.v4_partitions_count(), 4);

    // 1. Exact match /32 at priority 1 -> Allow (Rule 4)
    let res1 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.1.2.99",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res1.action, 0);
    assert_eq!(res1.rule_id, 4);

    // 2. IP in same /24 but not .99 -> Matches Rule 3 (/24, block)
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.1.2.100",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.action, 1);
    assert_eq!(res2.rule_id, 3);

    // 3. IP in same /16 but not 10.1.2.0/24 -> Matches Rule 2 (/16, allow)
    let res3 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.1.5.1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res3.action, 0);
    assert_eq!(res3.rule_id, 2);

    // 4. IP in same /8 but not 10.1.0.0/16 -> Matches Rule 1 (/8, block)
    let res4 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.99.1.1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res4.action, 1);
    assert_eq!(res4.rule_id, 1);

    // 5. IP outside 10.0.0.0/8 -> Default Allow (Rule 0)
    let res5 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.1.1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res5.action, 0);
    assert_eq!(res5.rule_id, 0);
}

#[test]
fn test_branch_and_bound_priority_override() {
    // Test where a wider prefix has higher priority than a narrower prefix
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 100,
                "priority": 1,
                "action": "allow",
                "networks": ["192.168.0.0/16"]
            },
            {
                "id": 200,
                "priority": 20,
                "action": "block",
                "networks": ["192.168.1.50/32"]
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();

    // 192.168.1.50 matches rule 100 (/16, priority 1) because priority 1 beats priority 20
    let res = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.1.50",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res.action, 0);
    assert_eq!(res.rule_id, 100);
}

#[test]
fn test_ipv6_mask_partitioning() {
    let raw = br#"{
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 10,
                "action": "block",
                "networks": ["2001:db8::/32"]
            },
            {
                "id": 2,
                "priority": 5,
                "action": "allow",
                "networks": ["2001:db8:cafe::/48"]
            },
            {
                "id": 3,
                "priority": 2,
                "action": "block",
                "networks": ["2001:db8:cafe:1::/64"]
            },
            {
                "id": 4,
                "priority": 1,
                "action": "allow",
                "networks": ["2001:db8:cafe:1::100/128"]
            }
        ]
    }"#;

    let engine = IpRestrictionEngine::from_snapshot(raw).unwrap();
    assert_eq!(engine.v6_partitions_count(), 4);

    // /128 match
    let res1 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:db8:cafe:1::100",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res1.action, 0);
    assert_eq!(res1.rule_id, 4);

    // /64 match
    let res2 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:db8:cafe:1::200",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res2.action, 1);
    assert_eq!(res2.rule_id, 3);

    // /48 match
    let res3 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:db8:cafe:2::1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res3.action, 0);
    assert_eq!(res3.rule_id, 2);

    // /32 match
    let res4 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:db8:beef::1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res4.action, 1);
    assert_eq!(res4.rule_id, 1);

    // Outside all
    let res5 = engine
        .evaluate(IpRestrictionRequest {
            ip: b"2001:cafe::1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res5.action, 0);
    assert_eq!(res5.rule_id, 0);
}

#[test]
fn test_large_rule_set_stress() {
    let mut networks = Vec::new();
    for i in 0..1000 {
        let octet2 = (i / 250) as u8;
        let octet3 = (i % 250) as u8;
        networks.push(format!("10.{octet2}.{octet3}.0/24"));
    }

    let snapshot = serde_json::json!({
        "schema_version": 1,
        "generation": 1,
        "rules": [
            {
                "id": 1,
                "priority": 100,
                "action": "block",
                "networks": networks
            }
        ]
    });

    let raw = serde_json::to_vec(&snapshot).unwrap();
    let engine = IpRestrictionEngine::from_snapshot(&raw).unwrap();

    // All 1000 networks share /24 mask -> exactly 1 partition!
    assert_eq!(engine.v4_partitions_count(), 1);

    // Hit test on network 500 (10.2.0.0/24)
    let res_hit = engine
        .evaluate(IpRestrictionRequest {
            ip: b"10.2.0.42",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res_hit.action, 1);
    assert_eq!(res_hit.rule_id, 1);

    // Miss test
    let res_miss = engine
        .evaluate(IpRestrictionRequest {
            ip: b"192.168.1.1",
            host: b"*",
            path: b"/",
            method: b"GET",
            now: 0,
        })
        .unwrap();
    assert_eq!(res_miss.action, 0);
    assert_eq!(res_miss.rule_id, 0);
}

#[test]
fn test_parse_ipv4_u32_pure_arithmetic() {
    use super::ip::parse_ipv4_u32;

    assert_eq!(parse_ipv4_u32(b"0.0.0.0"), Some(0x00000000));
    assert_eq!(parse_ipv4_u32(b"255.255.255.255"), Some(0xFFFFFFFF));
    assert_eq!(parse_ipv4_u32(b"192.168.1.1"), Some(0xC0A80101));
    assert_eq!(parse_ipv4_u32(b"10.0.0.1"), Some(0x0A000001));
    assert_eq!(parse_ipv4_u32(b"127.0.0.1"), Some(0x7F000001));

    // Invalid inputs
    assert_eq!(parse_ipv4_u32(b""), None);
    assert_eq!(parse_ipv4_u32(b"1.2.3"), None);
    assert_eq!(parse_ipv4_u32(b"1.2.3.4.5"), None);
    assert_eq!(parse_ipv4_u32(b"256.0.0.1"), None);
    assert_eq!(parse_ipv4_u32(b"192.168.0123.1"), None);
    assert_eq!(parse_ipv4_u32(b"192.168.1.a"), None);
    assert_eq!(parse_ipv4_u32(b".192.168.1.1"), None);
    assert_eq!(parse_ipv4_u32(b"192.168.1.1."), None);
}

#[test]
fn test_ip_restriction_policy_validation() {
    use super::policy::{IpRestrictionPolicy, IpRule};

    let mut policy = IpRestrictionPolicy {
        schema_version: 1,
        generation: 42,
        whitelist: vec!["10.0.0.0/8".to_string()],
        blacklist: vec!["192.168.1.100/32".to_string()],
        rules: vec![IpRule {
            id: serde_json::json!(1),
            cidr: "172.16.0.0/12".to_string(),
            r#type: "blacklist".to_string(),
            match_value: "".to_string(),
            action: "block".to_string(),
            priority: Some(10),
            enabled: Some(true),
            networks: vec![],
            path_prefix: Some("/api/v1".to_string()),
            host: "*".to_string(),
            method: "*".to_string(),
            log: false,
        }],
    };

    assert!(policy.validate().is_ok());

    // Schema version check
    policy.schema_version = 2;
    assert!(policy.validate().is_err());
    policy.schema_version = 1;

    // Invalid path prefix check
    policy.rules[0].path_prefix = Some("api/v1".to_string()); // Missing leading '/'
    assert!(policy.validate().is_err());
    policy.rules[0].path_prefix = Some("/api/v1".to_string());

    // Invalid priority check
    policy.rules[0].priority = Some(2_000_000);
    assert!(policy.validate().is_err());
    policy.rules[0].priority = Some(10);

    // Invalid CIDR check
    policy.whitelist[0] = "   ".to_string();
    assert!(policy.validate().is_err());
}

#[test]
fn test_ip_restriction_materialize_slot() {
    use super::materialize::materialize;
    use aurora_engine::shm::AURORA_EXT_IP_RESTRICTION;

    let config_val = serde_json::json!({
        "schema_version": 1,
        "generation": 100,
        "whitelist": ["10.0.0.0/8"],
        "blacklist": ["192.168.1.50/32"],
        "rules": [
            {
                "id": 101,
                "priority": 10,
                "action": "block",
                "networks": ["172.16.0.0/12"],
                "path_prefix": "/api/v1",
                "host": "*",
                "method": "GET"
            }
        ]
    });

    let mut shm_slots = Vec::new();
    let res = materialize(&config_val, &mut shm_slots);
    assert!(res.is_ok(), "Materialization failed: {:?}", res);

    assert_eq!(shm_slots.len(), 1);
    assert_eq!(shm_slots[0].0, AURORA_EXT_IP_RESTRICTION);

    let parsed: serde_json::Value = serde_json::from_slice(&shm_slots[0].1).unwrap();
    assert_eq!(parsed["generation"], 100);
    assert_eq!(parsed["whitelist"][0], "10.0.0.0/8");
}
