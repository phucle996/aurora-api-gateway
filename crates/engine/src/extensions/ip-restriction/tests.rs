use super::engine::IpRestrictionEngine;
use super::types::IpRestrictionRequest;

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
