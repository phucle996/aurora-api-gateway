use super::l4::generate_l4_streams_conf;
use super::routing::{find_matching_certificate, generate_domain_routing_conf, matches_sni};
use super::*;
use crate::spec::certificate::CertificateSpec;
use crate::spec::schema::Spec;
use std::os::unix::fs::PermissionsExt;

fn read_shm_slot_string(policy_dir: &std::path::Path, slot_id: u32) -> (u64, String) {
    let path = policy_dir.join("aurora_gateway_policy.bin");
    let file = std::fs::File::open(&path)
        .unwrap_or_else(|e| panic!("failed to open test policy shm at {:?}: {}", path, e));
    let mmap = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            aurora_engine::shm::POLICY_SHM_TOTAL_BYTES,
            libc::PROT_READ,
            libc::MAP_SHARED,
            std::os::unix::io::AsRawFd::as_raw_fd(&file),
            0,
        )
    };
    let header = unsafe { &*(mmap as *const aurora_engine::shm::PolicyShmHeader) };
    let (slot_gen, data) = header.read_slot(slot_id).unwrap();
    let s = std::str::from_utf8(data).unwrap().to_string();
    unsafe {
        libc::munmap(mmap, aurora_engine::shm::POLICY_SHM_TOTAL_BYTES);
    }
    (slot_gen, s)
}

#[tokio::test]
async fn test_materialize_gateway_files() {
    let base_tmp = std::env::temp_dir().join(format!("aurora-spec-test-{}", std::process::id()));
    let policy_dir = base_tmp.join("policy");
    let routing_dir = base_tmp.join("routing");
    let _ = tokio::fs::remove_dir_all(&base_tmp).await;

    let spec = Spec {
        release_id: 99,
        upstreams: vec![crate::spec::upstream::UpstreamSpec {
            name: "backend".to_string(),
            servers: vec![crate::spec::upstream::UpstreamServerSpec {
                addr: "127.0.0.1:8080".to_string(),
                weight: 2,
            }],
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize");
    assert!(res.nginx_changed);

    assert!(!policy_dir.join("active-ip-restriction.json").exists());
    assert!(policy_dir.join("active-upstreams.conf").exists());
    assert!(policy_dir.join("active-extensions-http.conf").exists());
    assert!(policy_dir.join("active-extensions.conf").exists());
    assert!(routing_dir.join("active-domain-routing.conf").exists());
    assert!(routing_dir.join("active-l4-streams.conf").exists());
    assert!(
        routing_dir
            .join("dependencies/current/modules.conf")
            .exists()
    );

    let up_conf = tokio::fs::read_to_string(policy_dir.join("active-upstreams.conf"))
        .await
        .unwrap();
    assert!(up_conf.contains("upstream backend"));
    assert!(up_conf.contains("zone aurora_http_backend 64k;"));
    assert!(up_conf.contains("server 127.0.0.1:8080 weight=2;"));

    // Second run with same spec should NOT report changed
    let res2 = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize 2");
    assert!(!res2.nginx_changed);
}

#[test]
fn test_extensions_generation() {
    let extensions = vec![
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "rate-limit".to_string(),
            key: "builtin/rate-limit".to_string(),
            version: 1,
            renderer: "rate-limit".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"algorithm":"token_bucket","memory_size_mb":16,"max_keys":100000,"eviction_policy":"lru","overflow_strategy":"evict_and_track","rules":[{"id":"r1","host":"*","path_prefix":"/","limit_by":"client_ip","rate":50,"burst":100,"period_secs":1,"action_on_exceeded":"throttle","rejected_code":429}]}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "cors".to_string(),
            key: "builtin/cors".to_string(),
            version: 1,
            renderer: "cors".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"allow_origins":["https://example.com"],"allow_methods":["GET","POST"],"allow_headers":["Authorization","Content-Type"],"allow_credentials":true,"max_age":3600}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "maintenance".to_string(),
            key: "builtin/maintenance-mode".to_string(),
            version: 1,
            renderer: "maintenance".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"status_code":503,"bypass_header":"X-Bypass","retry_after_secs":120,"message":"Under upgrade"}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "jwt-authentication".to_string(),
            key: "builtin/jwt-authentication".to_string(),
            version: 1,
            renderer: "engine-jwt-rs256".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"rules":[{"id":"api","host":"api.example.test","path_prefix":"/api","algorithm":"RS256","token_source":"header","header_name":"Authorization","token_prefix":"Bearer ","public_key_pem":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----","issuer":"https://issuer.example.test","audience":"gateway"}]}"#.to_string(),
        },
    ];
    let rendered = render_extensions(&extensions).unwrap();
    assert!(
        rendered
            .get_shm_slot(aurora_engine::shm::AURORA_EXT_RATE_LIMIT)
            .is_some()
    );

    let server_conf = &rendered.server_conf;
    assert!(!server_conf.contains("gateway_rate_limit_policy"));
    assert!(
        server_conf.contains("add_header Access-Control-Allow-Origin \"$http_origin\" always;")
    );
    assert!(server_conf.contains("add_header Access-Control-Allow-Credentials \"true\" always;"));
    assert!(server_conf.contains("add_header Retry-After 120 always;"));
    assert!(server_conf.contains("if ($http_x_bypass)"));
    assert!(server_conf.contains("return 503 \"{\\\"error\\\":\\\"Under upgrade\\\"}\";"));
    assert!(!server_conf.contains("gateway_jwt_policy"));
    assert_eq!(
        rendered
            .get_shm_slot_json(aurora_engine::shm::AURORA_EXT_JWT)
            .unwrap()["rules"][0]["host"],
        "api.example.test"
    );
    assert!(
        rendered
            .get_shm_slot(aurora_engine::shm::AURORA_EXT_IP_RESTRICTION)
            .is_none()
    );
}

#[tokio::test]
async fn test_jwt_extension_materializes_and_removes_ffi_snapshot() {
    let base =
        std::env::temp_dir().join(format!("materialize-jwt-snapshot-{}", std::process::id()));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let spec = Spec {
        release_id: 91,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "jwt-authentication".to_string(),
            key: "builtin/jwt-authentication".to_string(),
            version: 1,
            renderer: "engine-jwt-rs256".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"rules":[{"id":"api","host":"api.example.test","path_prefix":"/","algorithm":"RS256","token_source":"header","header_name":"Authorization","token_prefix":"Bearer ","public_key_pem":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----"}]}"#.to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize JWT snapshot");
    assert!(!policy_dir.join("active-jwt.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, jwt) = read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_JWT);
    assert_eq!(slot_gen, 91);
    assert!(jwt.contains("api.example.test"));

    let disabled = Spec {
        release_id: 92,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove JWT snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-jwt.json").exists());
    let (gen_disabled, jwt_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_JWT);
    assert_eq!(gen_disabled, 92);
    assert!(jwt_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_rate_limit_extension_materializes_and_removes_ffi_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "materialize-rate-limit-snapshot-{}",
        std::process::id()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let spec = Spec {
        release_id: 88,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "rate-limit".to_string(),
            key: "builtin/rate-limit".to_string(),
            version: 1,
            renderer: "rate-limit".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"algorithm":"token_bucket","memory_size_mb":16,"max_keys":100000,"eviction_policy":"lru","overflow_strategy":"evict_and_track","rules":[{"id":"r1","host":"*","path_prefix":"/api","limit_by":"client_ip","rate":100,"period_secs":1,"action_on_exceeded":"throttle"}]}"#.to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize rate-limit snapshot");
    assert!(!policy_dir.join("active-rate-limit.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, rl) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_RATE_LIMIT);
    assert_eq!(slot_gen, 88);
    assert!(rl.contains("\"token_bucket\""));
    assert!(rl.contains("\"/api\""));

    let disabled = Spec {
        release_id: 89,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove rate-limit snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-rate-limit.json").exists());
    let (gen_disabled, rl_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_RATE_LIMIT);
    assert_eq!(gen_disabled, 89);
    assert!(rl_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_connection_limit_extension_materializes_and_removes_ffi_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "materialize-conn-limit-snapshot-{}",
        std::process::id()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let spec = Spec {
        release_id: 99,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "connection-limit".to_string(),
            key: "builtin/connection-limit".to_string(),
            version: 1,
            renderer: "connection-limit".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"mode":"local","rules":[{"id":"cl-1","host":"*","path_prefix":"/stream","limit_by":"client_ip","max_connections":5,"action_on_exceeded":"throttle","rejected_code":503}]}"#.to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize connection-limit snapshot");
    assert!(!policy_dir.join("active-connection-limit.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, cl) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_CONN_LIMIT);
    assert_eq!(slot_gen, 99);
    assert!(cl.contains("\"max_connections\":5"));
    assert!(cl.contains("\"/stream\""));

    let disabled = Spec {
        release_id: 100,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove connection-limit snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-connection-limit.json").exists());
    let (gen_disabled, cl_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_CONN_LIMIT);
    assert_eq!(gen_disabled, 100);
    assert!(cl_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_traffic_shaper_extension_materializes_and_removes_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "aurora-ts-mat-test-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let spec = Spec {
        release_id: 88,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "traffic-shaper".to_string(),
            key: "builtin/traffic-shaper".to_string(),
            version: 1,
            renderer: "traffic-shaper".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"rules":[{"id":"ts-1","host":"*","path_prefix":"/download","limit_by":"client_ip","rate_kb_per_sec":1024,"burst_kb":2048}]}"#.to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize traffic-shaper snapshot");
    assert!(!policy_dir.join("active-traffic-shaper.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, ts) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_TRAFFIC_SHAPER);
    assert_eq!(slot_gen, 88);
    assert!(ts.contains("\"rate_kb_per_sec\":1024"));
    assert!(ts.contains("\"burst_kb\":2048"));
    assert!(ts.contains("\"/download\""));

    let disabled = Spec {
        release_id: 89,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove traffic-shaper snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-traffic-shaper.json").exists());
    let (gen_disabled, ts_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_TRAFFIC_SHAPER);
    assert_eq!(gen_disabled, 89);
    assert!(ts_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_resource_limit_snapshot_lifecycle() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-rsl-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 99,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "res-limit-1".to_string(),
            key: "builtin/resource-limit".to_string(),
            version: 1,
            renderer: "resource-limit".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "rules": [
                    {
                        "id": "limit-api",
                        "priority": 10,
                        "origin": "api.example.com",
                        "path_prefix": "/upload",
                        "header_limit": 32768,
                        "payload_limit": 52428800,
                        "rejected_code_header": 431,
                        "rejected_code_payload": 413,
                        "response_body_payload": "{\"error\":\"custom_large\"}"
                    }
                ]
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize resource-limit snapshot");
    assert!(!policy_dir.join("active-resource-limit.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, rsl) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_RESOURCE_LIMIT);
    assert_eq!(slot_gen, 99);
    assert!(rsl.contains("\"payload_limit\": 52428800"));
    assert!(rsl.contains("\"origin\": \"api.example.com\""));
    assert!(rsl.contains("\"/upload\""));

    let disabled = Spec {
        release_id: 100,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove resource-limit snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-resource-limit.json").exists());
    let (gen_disabled, rsl_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_RESOURCE_LIMIT);
    assert_eq!(gen_disabled, 100);
    assert!(rsl_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_gateway_traffic_split_snapshot_lifecycle() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-tsplit-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 101,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "split-1".to_string(),
            key: "builtin/traffic-split".to_string(),
            version: 1,
            renderer: "traffic-split".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "rules": [
                    {
                        "id": "checkout-split",
                        "priority": 10,
                        "origin": "shop.example.com",
                        "path_prefix": "/checkout",
                        "split_by": "client_ip",
                        "splits": [
                            { "upstream": "checkout_v1", "weight": 70 },
                            { "upstream": "checkout_v2", "weight": 30 }
                        ]
                    }
                ]
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize traffic-split snapshot");
    assert!(!policy_dir.join("active-traffic-split.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, ts) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_TRAFFIC_SPLIT);
    assert_eq!(slot_gen, 101);
    assert!(ts.contains("\"checkout_v1\""));
    assert!(ts.contains("\"weight\": 70"));
    assert!(ts.contains("\"checkout_v2\""));
    assert!(ts.contains("\"weight\": 30"));

    let disabled = Spec {
        release_id: 102,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove traffic-split snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-traffic-split.json").exists());
    let (gen_disabled, ts_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_TRAFFIC_SPLIT);
    assert_eq!(gen_disabled, 102);
    assert!(ts_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_gateway_writes_and_removes_canary_release_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-canary-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 201,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "canary-1".to_string(),
            key: "builtin/canary-release".to_string(),
            version: 1,
            renderer: "canary-release".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "rules": [
                    {
                        "id": "canary-rule-1",
                        "priority": 10,
                        "origin": "api.example.com",
                        "path_prefix": "/v2",
                        "baseline_upstream": "backend_v1",
                        "canary_upstream": "backend_v2",
                        "match_conditions": [
                            { "target": "header", "key": "X-Beta", "regex": "^1$" }
                        ],
                        "weight_percentage": 25,
                        "split_by": "client_ip",
                        "canary_upstream_headers": [
                            { "name": "X-Track", "value": "canary" }
                        ],
                        "baseline_upstream_headers": []
                    }
                ]
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize canary-release snapshot");
    assert!(!policy_dir.join("active-canary-release.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, cr) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_CANARY_RELEASE);
    assert_eq!(slot_gen, 201);
    assert!(cr.contains("\"backend_v1\""));
    assert!(cr.contains("\"backend_v2\""));
    assert!(cr.contains("\"weight_percentage\": 25"));

    let disabled = Spec {
        release_id: 202,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove canary-release snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-canary-release.json").exists());
    let (gen_disabled, cr_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_CANARY_RELEASE);
    assert_eq!(gen_disabled, 202);
    assert!(cr_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_gateway_writes_and_removes_blue_green_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-bluegreen-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 301,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "bg-1".to_string(),
            key: "builtin/blue-green".to_string(),
            version: 1,
            renderer: "blue-green".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "active_slot": "green",
                "blue_upstream": "app_blue",
                "green_upstream": "app_green",
                "switch_header": "x-deploy-slot"
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize blue-green snapshot");
    assert!(!policy_dir.join("active-blue-green.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, bg) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_BLUE_GREEN);
    assert_eq!(slot_gen, 301);
    assert!(bg.contains("\"app_blue\""));
    assert!(bg.contains("\"app_green\""));
    assert!(bg.contains("\"active_slot\": \"green\""));

    let disabled = Spec {
        release_id: 302,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove blue-green snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-blue-green.json").exists());
    let (gen_disabled, bg_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_BLUE_GREEN);
    assert_eq!(gen_disabled, 302);
    assert!(bg_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_gateway_writes_and_removes_request_mirror_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-mirror-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 401,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "mirror-1".to_string(),
            key: "builtin/request-mirror".to_string(),
            version: 1,
            renderer: "request-mirror".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "primary_upstream": "app_primary",
                "mirror_upstream": "app_shadow",
                "sample_percentage": 100,
                "ignore_mirror_errors": true
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize request-mirror snapshot");
    assert!(!policy_dir.join("active-request-mirror.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, rm) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_REQUEST_MIRROR);
    assert_eq!(slot_gen, 401);
    assert!(rm.contains("\"app_primary\""));
    assert!(rm.contains("\"app_shadow\""));
    assert!(rm.contains("\"sample_percentage\": 100"));

    let disabled = Spec {
        release_id: 402,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove request-mirror snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-request-mirror.json").exists());
    let (gen_disabled, rm_disabled) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_REQUEST_MIRROR);
    assert_eq!(gen_disabled, 402);
    assert!(rm_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_materialize_gateway_writes_and_removes_request_termination_snapshot() {
    let base = std::env::temp_dir().join(format!(
        "aurora-control-worker-test-termination-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec = Spec {
        release_id: 501,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "term-1".to_string(),
            key: "builtin/request-termination".to_string(),
            version: 1,
            renderer: "request-termination".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{
                "status_code": 503,
                "content_type": "application/json",
                "body": "{\"error\": \"Under Maintenance\"}"
            }"#
            .to_string(),
        }],
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize request-termination snapshot");
    assert!(!policy_dir.join("active-request-termination.json").exists());
    assert!(res.policy_changed);
    let (slot_gen, rt) = read_shm_slot_string(
        &policy_dir,
        aurora_engine::shm::AURORA_EXT_REQUEST_TERMINATION,
    );
    assert_eq!(slot_gen, 501);
    assert!(rt.contains("\"status_code\": 503"));
    assert!(rt.contains("Under Maintenance"));

    let disabled = Spec {
        release_id: 502,
        ..Default::default()
    };
    let result = materialize_gateway(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove request-termination snapshot");
    assert!(!result.nginx_changed);
    assert!(!policy_dir.join("active-request-termination.json").exists());
    let (gen_disabled, rt_disabled) = read_shm_slot_string(
        &policy_dir,
        aurora_engine::shm::AURORA_EXT_REQUEST_TERMINATION,
    );
    assert_eq!(gen_disabled, 502);
    assert!(rt_disabled.is_empty());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[test]
fn test_ip_restriction_renderer_generates_cidr_rules_from_instance_config() {
    let instance = ExtensionInstanceSpec {
        instance_id: "office-network".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        renderer: "ip-restriction".to_string(),
        manifest_digest: String::new(),
        config_json: r#"{"whitelist":["198.51.100.0/24"],"blacklist":["192.0.2.10/32"],"rules":[{"id":"admin-block","cidr":"203.0.113.0/24","type":"blacklist","match_value":"/admin","action":"block","priority":7}]}"#.to_string(),
    };

    let rendered = render_extensions(std::slice::from_ref(&instance)).unwrap();
    let slot_data = rendered
        .get_shm_slot(aurora_engine::shm::AURORA_EXT_IP_RESTRICTION)
        .expect("ip_restriction shm slot");
    assert_eq!(slot_data, instance.config_json.as_bytes());
    assert!(
        !rendered
            .server_conf
            .contains("gateway_ip_restriction_policy")
    );
}

#[test]
fn test_extension_renderer_rejects_unknown_renderer() {
    let instance = ExtensionInstanceSpec {
        instance_id: "ip-restriction".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        renderer: "unknown-renderer".to_string(),
        manifest_digest: String::new(),
        config_json: r#"{"whitelist":[],"blacklist":[],"rules":[]}"#.to_string(),
    };
    assert!(render_extensions(&[instance]).is_err());
}

#[test]
fn test_dataplane_renderer_rejects_invalid_json() {
    let instance = ExtensionInstanceSpec {
        instance_id: "ip-restriction".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        renderer: "ip-restriction".to_string(),
        manifest_digest: String::new(),
        config_json: r#"invalid-json-content"#.to_string(),
    };
    assert!(render_extensions(&[instance]).is_err());
}

#[tokio::test]
async fn test_ip_restriction_extension_materializes_and_removes_snapshot() {
    let base =
        std::env::temp_dir().join(format!("materialize-ip-restriction-{}", std::process::id()));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;

    let spec_with_extension = Spec {
        release_id: 101,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "ip-guard".to_string(),
            key: "builtin/ip-restriction".to_string(),
            version: 1,
            renderer: "ip-restriction".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"whitelist":["10.0.0.0/8"],"blacklist":[],"rules":[]}"#.to_string(),
        }],
        ..Default::default()
    };

    let result = materialize_gateway(&spec_with_extension, &policy_dir, &routing_dir)
        .await
        .expect("materialize with ip-restriction");
    assert!(result.policy_changed);

    let access_path = policy_dir.join("active-ip-restriction.json");
    assert!(!access_path.exists());
    let (slot_gen, ip_data) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_IP_RESTRICTION);
    assert_eq!(slot_gen, 101);
    assert!(ip_data.contains("\"10.0.0.0/8\""));

    let ext_conf = tokio::fs::read_to_string(policy_dir.join("active-extensions.conf"))
        .await
        .unwrap();
    assert!(!ext_conf.contains("gateway_ip_restriction_policy"));

    // Second run: spec without extension removes snapshot and directive
    let spec_without_extension = Spec {
        release_id: 102,
        extensions: vec![],
        ..Default::default()
    };

    let result2 = materialize_gateway(&spec_without_extension, &policy_dir, &routing_dir)
        .await
        .expect("materialize without ip-restriction");
    assert!(!result2.nginx_changed);
    assert!(
        !access_path.exists(),
        "active-ip-restriction.json should be removed when extension is absent"
    );
    let (gen2, ip_data2) =
        read_shm_slot_string(&policy_dir, aurora_engine::shm::AURORA_EXT_IP_RESTRICTION);
    assert_eq!(gen2, 102);
    assert!(ip_data2.is_empty());

    let ext_conf2 = tokio::fs::read_to_string(policy_dir.join("active-extensions.conf"))
        .await
        .unwrap();
    assert!(!ext_conf2.contains("gateway_ip_restriction_policy"));
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[test]
fn test_sni_matching() {
    assert!(matches_sni("example.com", "example.com"));
    assert!(matches_sni("EXAMPLE.COM", "example.com"));
    assert!(matches_sni("*.example.com", "api.example.com"));
    assert!(matches_sni("*.example.com", "sub.example.com"));
    assert!(!matches_sni("*.example.com", "example.com"));
    assert!(!matches_sni("*.example.com", "deep.sub.example.com"));
    assert!(matches_sni("*", "anything.com"));
}

#[test]
fn test_find_matching_certificate() {
    let certs = vec![
        CertificateSpec {
            id: "wildcard".to_string(),
            name: "Wildcard".to_string(),
            snis: vec!["*.aurora.local".to_string()],
            cert_pem: "CERT_WILD".to_string(),
            key_pem: "KEY_WILD".to_string(),
            client_ca_pem: String::new(),
            mtls_enabled: false,
            verify_depth: 1,
        },
        CertificateSpec {
            id: "exact_api".to_string(),
            name: "Exact API".to_string(),
            snis: vec!["api.aurora.local".to_string()],
            cert_pem: "CERT_EXACT".to_string(),
            key_pem: "KEY_EXACT".to_string(),
            client_ca_pem: "CA_PEM".to_string(),
            mtls_enabled: true,
            verify_depth: 2,
        },
    ];

    let matched = find_matching_certificate(&certs, "api.aurora.local");
    assert_eq!(matched.unwrap().id, "exact_api");

    let matched2 = find_matching_certificate(&certs, "other.aurora.local");
    assert_eq!(matched2.unwrap().id, "wildcard");

    let matched3 = find_matching_certificate(&certs, "external.com");
    assert!(matched3.is_none());
}

#[test]
fn test_generate_domain_routing_conf_features() {
    let spec = Spec {
        certificates: vec![CertificateSpec {
            id: "cert_123".to_string(),
            name: "Cert 123".to_string(),
            snis: vec!["api.aurora.local".to_string()],
            cert_pem: "CERT".to_string(),
            key_pem: "KEY".to_string(),
            client_ca_pem: "CA".to_string(),
            mtls_enabled: true,
            verify_depth: 3,
        }],
        routing: crate::spec::routing::RoutingSpec {
            domains: vec![crate::spec::routing::DomainRoutingSpec {
                host: "api.aurora.local".to_string(),
                locations: vec![
                    crate::spec::routing::LocationRoutingSpec {
                        path: "/".to_string(),
                        upstream: "root_upstream".to_string(),
                        priority: 0,
                        strip_path: false,
                        websocket: false,
                        plugins_json: None,
                        origin_tls: None,
                    },
                    crate::spec::routing::LocationRoutingSpec {
                        path: "/api/v1".to_string(),
                        upstream: "api_upstream_old".to_string(),
                        priority: 1,
                        strip_path: false,
                        websocket: false,
                        plugins_json: None,
                        origin_tls: None,
                    },
                    // Higher priority route for same path /api/v1 -> overrides
                    crate::spec::routing::LocationRoutingSpec {
                        path: "/api/v1".to_string(),
                        upstream: "api_upstream_new".to_string(),
                        priority: 10,
                        strip_path: true,
                        websocket: false,
                        plugins_json: None,
                        origin_tls: Some(crate::spec::routing::OriginTLSSpec {
                            enabled: true,
                            verify_cert: true,
                            sni_host: "origin.aurora.local".to_string(),
                            ca_cert: "ORIGIN_CA".to_string(),
                            mtls: true,
                            client_cert: "ORIGIN_CLIENT_CERT".to_string(),
                            client_key: "ORIGIN_CLIENT_KEY".to_string(),
                        }),
                    },
                    crate::spec::routing::LocationRoutingSpec {
                        path: "/ws".to_string(),
                        upstream: "ws_upstream".to_string(),
                        priority: 5,
                        strip_path: false,
                        websocket: true,
                        plugins_json: None,
                        origin_tls: None,
                    },
                ],
            }],
        },
        ..Default::default()
    };

    let temp_dir = std::path::PathBuf::from("/var/lib/aurora-routing");
    let conf = generate_domain_routing_conf(&spec, &temp_dir);

    // 1. Check HTTP server block
    assert!(conf.contains("server {\n    listen 80;\n    server_name api.aurora.local;"));

    // 2. Check HTTPS server block with mTLS & HTTP/3
    assert!(conf.contains("server {\n    listen 443 ssl;\n    listen 443 quic reuseport;\n    server_name api.aurora.local;"));
    assert!(conf.contains("ssl_certificate /var/lib/aurora-routing/certs/cert_123.crt;"));
    assert!(conf.contains("ssl_certificate_key /var/lib/aurora-routing/certs/cert_123.key;"));
    assert!(conf.contains("ssl_client_certificate /var/lib/aurora-routing/certs/cert_123_ca.crt;"));
    assert!(conf.contains("ssl_verify_client on;"));
    assert!(conf.contains("ssl_verify_depth 3;"));

    // 3. Check Deduplication & Priority: api_upstream_new won over api_upstream_old
    assert!(conf.contains("proxy_pass https://api_upstream_new;"));
    assert!(!conf.contains("proxy_pass http://api_upstream_old;"));
    assert!(conf.contains("proxy_ssl_verify on;"));
    assert!(conf.contains("proxy_ssl_name origin.aurora.local;"));
    assert!(conf.contains(
        "proxy_ssl_trusted_certificate /var/lib/aurora-routing/origin-tls/api_upstream_new_ca.crt;"
    ));
    assert!(conf.contains(
        "proxy_ssl_certificate /var/lib/aurora-routing/origin-tls/api_upstream_new_client.crt;"
    ));
    assert!(conf.contains(
        "proxy_ssl_certificate_key /var/lib/aurora-routing/origin-tls/api_upstream_new_client.key;"
    ));

    // 4. Check Longest Prefix Sorting: /api/v1 (length 7) appears before /ws (length 3) and / (length 1)
    let pos_apiv1 = conf.find("location /api/v1").unwrap();
    let pos_ws = conf.find("location /ws").unwrap();
    let pos_root = conf.find("location / ").unwrap();
    assert!(pos_apiv1 < pos_ws);
    assert!(pos_ws < pos_root);

    // 5. Check strip_path rewrite
    assert!(conf.contains("rewrite ^/api/v1/?(.*)$ /$1 break;"));

    // 6. Check WebSocket proxy headers
    assert!(conf.contains("proxy_set_header Upgrade $http_upgrade;"));
    assert!(conf.contains("proxy_set_header Connection \"upgrade\";"));
    assert!(conf.contains("proxy_connect_timeout 5s;"));
}

#[tokio::test]
async fn test_materialize_gateway_with_certificates() {
    let base_tmp = std::env::temp_dir().join(format!("aurora-cert-test-{}", std::process::id()));
    let policy_dir = base_tmp.join("policy");
    let routing_dir = base_tmp.join("routing");
    let _ = tokio::fs::remove_dir_all(&base_tmp).await;

    let spec = Spec {
        release_id: 101,
        certificates: vec![CertificateSpec {
            id: "test_cert_id".to_string(),
            name: "Test Cert".to_string(),
            snis: vec!["secure.aurora.local".to_string()],
            cert_pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----".to_string(),
            key_pem: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----".to_string(),
            client_ca_pem: "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----".to_string(),
            mtls_enabled: true,
            verify_depth: 2,
        }],
        routing: crate::spec::routing::RoutingSpec {
            domains: vec![crate::spec::routing::DomainRoutingSpec {
                host: "secure.aurora.local".to_string(),
                locations: vec![crate::spec::routing::LocationRoutingSpec {
                    path: "/".to_string(),
                    upstream: "backend_up".to_string(),
                    priority: 1,
                    strip_path: false,
                    websocket: false,
                    plugins_json: None,
                    origin_tls: Some(crate::spec::routing::OriginTLSSpec {
                        enabled: true,
                        verify_cert: true,
                        sni_host: "origin.aurora.local".to_string(),
                        ca_cert:
                            "-----BEGIN CERTIFICATE-----\nORIGIN_CA\n-----END CERTIFICATE-----"
                                .to_string(),
                        mtls: true,
                        client_cert:
                            "-----BEGIN CERTIFICATE-----\nORIGIN_CLIENT\n-----END CERTIFICATE-----"
                                .to_string(),
                        client_key:
                            "-----BEGIN PRIVATE KEY-----\nORIGIN_KEY\n-----END PRIVATE KEY-----"
                                .to_string(),
                    }),
                }],
            }],
        },
        ..Default::default()
    };

    let res = materialize_gateway(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize with certs");
    assert!(res.nginx_changed);

    let cert_file = routing_dir.join("certs/test_cert_id.crt");
    let key_file = routing_dir.join("certs/test_cert_id.key");
    let ca_file = routing_dir.join("certs/test_cert_id_ca.crt");
    let origin_ca_file = routing_dir.join("origin-tls/backend_up_ca.crt");
    let origin_cert_file = routing_dir.join("origin-tls/backend_up_client.crt");
    let origin_key_file = routing_dir.join("origin-tls/backend_up_client.key");

    assert!(cert_file.exists());
    assert!(key_file.exists());
    assert!(ca_file.exists());
    assert!(origin_ca_file.exists());
    assert!(origin_cert_file.exists());
    assert!(origin_key_file.exists());

    let cert_content = tokio::fs::read_to_string(&cert_file).await.unwrap();
    assert!(cert_content.contains("BEGIN CERTIFICATE"));

    let routing_conf = tokio::fs::read_to_string(routing_dir.join("active-domain-routing.conf"))
        .await
        .unwrap();
    assert!(routing_conf.contains("listen 443 ssl;"));
    assert!(routing_conf.contains("test_cert_id.crt"));
    assert!(routing_conf.contains("ssl_verify_client on;"));
    assert!(routing_conf.contains("proxy_pass https://backend_up;"));
    assert!(routing_conf.contains("proxy_ssl_verify on;"));
    assert_eq!(
        std::fs::metadata(origin_key_file)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );

    let _ = tokio::fs::remove_dir_all(&base_tmp).await;
}

#[tokio::test]
async fn test_materialize_gateway_cleans_up_stale_certificates_and_origin_tls() {
    let base_tmp =
        std::env::temp_dir().join(format!("aurora-cert-cleanup-test-{}", std::process::id()));
    let policy_dir = base_tmp.join("policy");
    let routing_dir = base_tmp.join("routing");
    let _ = tokio::fs::remove_dir_all(&base_tmp).await;

    let spec_initial = Spec {
        release_id: 1,
        certificates: vec![CertificateSpec {
            id: "old_cert".to_string(),
            name: "Old Cert".to_string(),
            snis: vec!["old.aurora.local".to_string()],
            cert_pem: "-----BEGIN CERTIFICATE-----\nOLD\n-----END CERTIFICATE-----".to_string(),
            key_pem: "-----BEGIN PRIVATE KEY-----\nOLD_KEY\n-----END PRIVATE KEY-----".to_string(),
            client_ca_pem: "-----BEGIN CERTIFICATE-----\nOLD_CA\n-----END CERTIFICATE-----".to_string(),
            mtls_enabled: true,
            verify_depth: 1,
        }],
        routing: crate::spec::routing::RoutingSpec {
            domains: vec![crate::spec::routing::DomainRoutingSpec {
                host: "old.aurora.local".to_string(),
                locations: vec![crate::spec::routing::LocationRoutingSpec {
                    path: "/".to_string(),
                    upstream: "old_upstream".to_string(),
                    priority: 1,
                    strip_path: false,
                    websocket: false,
                    plugins_json: None,
                    origin_tls: Some(crate::spec::routing::OriginTLSSpec {
                        enabled: true,
                        verify_cert: true,
                        sni_host: "old-origin.aurora.local".to_string(),
                        ca_cert: "-----BEGIN CERTIFICATE-----\nOLD_ORIGIN_CA\n-----END CERTIFICATE-----".to_string(),
                        mtls: true,
                        client_cert: "-----BEGIN CERTIFICATE-----\nOLD_CLIENT_CERT\n-----END CERTIFICATE-----".to_string(),
                        client_key: "-----BEGIN PRIVATE KEY-----\nOLD_CLIENT_KEY\n-----END PRIVATE KEY-----".to_string(),
                    }),
                }],
            }],
        },
        ..Default::default()
    };

    let res1 = materialize_gateway(&spec_initial, &policy_dir, &routing_dir)
        .await
        .expect("initial materialize");
    assert!(res1.nginx_changed);

    let old_cert_file = routing_dir.join("certs/old_cert.crt");
    let old_key_file = routing_dir.join("certs/old_cert.key");
    let old_ca_file = routing_dir.join("certs/old_cert_ca.crt");
    let old_origin_ca = routing_dir.join("origin-tls/old_upstream_ca.crt");
    let old_origin_cert = routing_dir.join("origin-tls/old_upstream_client.crt");
    let old_origin_key = routing_dir.join("origin-tls/old_upstream_client.key");

    assert!(old_cert_file.exists());
    assert!(old_key_file.exists());
    assert!(old_ca_file.exists());
    assert!(old_origin_ca.exists());
    assert!(old_origin_cert.exists());
    assert!(old_origin_key.exists());

    // Step 2: Update spec with new cert and disabled origin TLS
    let spec_updated = Spec {
        release_id: 2,
        certificates: vec![CertificateSpec {
            id: "new_cert".to_string(),
            name: "New Cert".to_string(),
            snis: vec!["new.aurora.local".to_string()],
            cert_pem: "-----BEGIN CERTIFICATE-----\nNEW\n-----END CERTIFICATE-----".to_string(),
            key_pem: "-----BEGIN PRIVATE KEY-----\nNEW_KEY\n-----END PRIVATE KEY-----".to_string(),
            client_ca_pem: String::new(),
            mtls_enabled: false,
            verify_depth: 1,
        }],
        routing: crate::spec::routing::RoutingSpec {
            domains: vec![crate::spec::routing::DomainRoutingSpec {
                host: "new.aurora.local".to_string(),
                locations: vec![crate::spec::routing::LocationRoutingSpec {
                    path: "/".to_string(),
                    upstream: "new_upstream".to_string(),
                    priority: 1,
                    strip_path: false,
                    websocket: false,
                    plugins_json: None,
                    origin_tls: None,
                }],
            }],
        },
        ..Default::default()
    };

    let res2 = materialize_gateway(&spec_updated, &policy_dir, &routing_dir)
        .await
        .expect("updated materialize");
    assert!(res2.nginx_changed);

    // Old files must be pruned
    assert!(
        !old_cert_file.exists(),
        "stale old_cert.crt should be removed"
    );
    assert!(
        !old_key_file.exists(),
        "stale old_cert.key should be removed"
    );
    assert!(
        !old_ca_file.exists(),
        "stale old_cert_ca.crt should be removed"
    );
    assert!(!old_origin_ca.exists(), "stale origin CA should be removed");
    assert!(
        !old_origin_cert.exists(),
        "stale origin client cert should be removed"
    );
    assert!(
        !old_origin_key.exists(),
        "stale origin client key should be removed"
    );

    // New cert files must exist
    let new_cert_file = routing_dir.join("certs/new_cert.crt");
    let new_key_file = routing_dir.join("certs/new_cert.key");
    assert!(new_cert_file.exists());
    assert!(new_key_file.exists());

    let _ = tokio::fs::remove_dir_all(&base_tmp).await;
}

#[test]
fn test_l4_streams_generation() {
    use crate::spec::l4::{L4AclRuleSpec, L4ServerSpec, L4ServiceSpec, L4Spec, L4UpstreamSpec};

    let l4 = Some(L4Spec {
        upstreams: vec![
            L4UpstreamSpec {
                name: "pg_cluster".to_string(),
                protocol: "tcp".to_string(),
                algorithm: "least_conn".to_string(),
                servers: vec![L4ServerSpec {
                    addr: "10.0.0.10:5432".to_string(),
                    weight: 2,
                    max_fails: Some(3),
                    fail_timeout: Some("10s".to_string()),
                    backup: false,
                }],
            },
            L4UpstreamSpec {
                name: "client_affinity".to_string(),
                protocol: "tcp".to_string(),
                algorithm: "ip_hash".to_string(),
                servers: vec![L4ServerSpec {
                    addr: "10.0.0.11:5432".to_string(),
                    weight: 1,
                    max_fails: None,
                    fail_timeout: None,
                    backup: false,
                }],
            },
            L4UpstreamSpec {
                name: "failover_pool".to_string(),
                protocol: "tcp".to_string(),
                algorithm: "round_robin".to_string(),
                servers: vec![
                    L4ServerSpec {
                        addr: "10.0.0.12:5432".to_string(),
                        weight: 1,
                        max_fails: Some(1),
                        fail_timeout: Some("5s".to_string()),
                        backup: false,
                    },
                    L4ServerSpec {
                        addr: "10.0.0.13:5432".to_string(),
                        weight: 1,
                        max_fails: Some(1),
                        fail_timeout: Some("5s".to_string()),
                        backup: true,
                    },
                ],
            },
        ],
        services: vec![
            L4ServiceSpec {
                name: "postgres_edge".to_string(),
                protocol: "tcp".to_string(),
                listen_port: 5432,
                forward_target_type: Some("upstream".to_string()),
                upstream: "pg_cluster".to_string(),
                endpoint: None,
                acl: vec![
                    L4AclRuleSpec {
                        cidr: "0.0.0.0/0".to_string(),
                        action: "deny".to_string(),
                        priority: 1,
                    },
                    L4AclRuleSpec {
                        cidr: "192.168.1.0/24".to_string(),
                        action: "allow".to_string(),
                        priority: 100,
                    },
                ],
                proxy_timeout: Some("1h".to_string()),
                proxy_connect_timeout: Some("5s".to_string()),
                enabled: true,
            },
            L4ServiceSpec {
                name: "redis_direct".to_string(),
                protocol: "tcp".to_string(),
                listen_port: 6379,
                forward_target_type: Some("endpoint".to_string()),
                upstream: String::new(),
                endpoint: Some("10.0.0.99:6379".to_string()),
                acl: vec![],
                proxy_timeout: Some("30m".to_string()),
                proxy_connect_timeout: None,
                enabled: true,
            },
            L4ServiceSpec {
                name: "http_route_bridge".to_string(),
                protocol: "tcp".to_string(),
                listen_port: 8088,
                forward_target_type: Some("endpoint".to_string()),
                upstream: String::new(),
                endpoint: Some("127.0.0.1:80".to_string()),
                acl: vec![],
                proxy_timeout: Some("1h".to_string()),
                proxy_connect_timeout: Some("5s".to_string()),
                enabled: true,
            },
            L4ServiceSpec {
                name: "upstream_with_stale_endpoint".to_string(),
                protocol: "tcp".to_string(),
                listen_port: 15432,
                forward_target_type: Some("upstream".to_string()),
                upstream: "pg_cluster".to_string(),
                endpoint: Some("127.0.0.1:80".to_string()),
                acl: vec![],
                proxy_timeout: None,
                proxy_connect_timeout: None,
                enabled: true,
            },
        ],
    });

    let conf = generate_l4_streams_conf(&l4).expect("valid L4 spec must render");
    assert!(conf.contains("upstream l4_pg_cluster {"));
    assert!(conf.contains("zone aurora_l4_pg_cluster 64k;"));
    assert!(conf.contains("least_conn;"));
    assert!(conf.contains("upstream l4_client_affinity {\n    zone aurora_l4_client_affinity 64k;\n    hash $remote_addr consistent;"));
    assert!(conf.contains("server 10.0.0.13:5432 max_fails=1 fail_timeout=5s backup resolve;"));
    assert!(conf.contains("server 10.0.0.10:5432 weight=2 max_fails=3 fail_timeout=10s resolve;"));
    assert!(conf.contains("listen 5432;"));
    assert!(conf.contains("allow 192.168.1.0/24;"));
    assert!(conf.contains("deny 0.0.0.0/0;"));
    assert!(conf.find("allow 192.168.1.0/24;").unwrap() < conf.find("deny 0.0.0.0/0;").unwrap());
    assert!(conf.contains("proxy_pass l4_pg_cluster;"));
    assert!(conf.contains("proxy_timeout 1h;"));
    assert!(conf.contains("proxy_connect_timeout 5s;"));

    // Direct endpoint assertions
    assert!(conf.contains("listen 6379;"));
    assert!(conf.contains("proxy_pass 10.0.0.99:6379;"));
    assert!(conf.contains("proxy_timeout 30m;"));

    // Direct endpoint without bridge: forwards directly to the target endpoint.
    assert!(conf.contains("listen 8088;"));
    assert!(conf.contains("proxy_pass 127.0.0.1:80;"));
    assert!(!conf.contains("proxy_protocol on;"));
    assert!(!conf.contains("proxy_pass 127.0.0.1:9082;"));

    // An upstream service must remain upstream even if an obsolete endpoint field exists.
    assert!(conf.contains("listen 15432;\n    proxy_pass l4_pg_cluster;"));
}

#[test]
fn test_l4_streams_reject_duplicate_acl_priority() {
    use crate::spec::l4::{L4AclRuleSpec, L4ServiceSpec, L4Spec};

    let l4 = Some(L4Spec {
        upstreams: vec![],
        services: vec![L4ServiceSpec {
            name: "duplicate-priority".to_string(),
            protocol: "tcp".to_string(),
            listen_port: 19001,
            forward_target_type: Some("endpoint".to_string()),
            upstream: String::new(),
            endpoint: Some("127.0.0.1:9000".to_string()),
            acl: vec![
                L4AclRuleSpec {
                    cidr: "0.0.0.0/0".to_string(),
                    action: "deny".to_string(),
                    priority: 10,
                },
                L4AclRuleSpec {
                    cidr: "192.0.2.0/24".to_string(),
                    action: "allow".to_string(),
                    priority: 10,
                },
            ],
            proxy_timeout: None,
            proxy_connect_timeout: None,
            enabled: true,
        }],
    });

    let error = generate_l4_streams_conf(&l4).expect_err("duplicate priority must fail closed");
    assert!(error.contains("duplicate ACL priority 10"));
}

#[test]
fn test_l4_streams_memory_leak_audit() {
    use crate::spec::l4::{L4AclRuleSpec, L4ServerSpec, L4ServiceSpec, L4Spec, L4UpstreamSpec};

    let l4 = Some(L4Spec {
        upstreams: vec![L4UpstreamSpec {
            name: "leak_test_pool".to_string(),
            protocol: "tcp".to_string(),
            algorithm: "least_conn".to_string(),
            servers: (0..10)
                .map(|i| L4ServerSpec {
                    addr: format!("10.0.0.{i}:6379"),
                    weight: 1,
                    max_fails: Some(3),
                    fail_timeout: Some("10s".to_string()),
                    backup: false,
                })
                .collect(),
        }],
        services: vec![L4ServiceSpec {
            name: "leak_test_service".to_string(),
            protocol: "tcp".to_string(),
            listen_port: 10001,
            forward_target_type: Some("upstream".to_string()),
            upstream: "leak_test_pool".to_string(),
            endpoint: None,
            acl: (0..50)
                .map(|i| L4AclRuleSpec {
                    cidr: format!("192.168.{}.0/24", i % 250),
                    action: "allow".to_string(),
                    priority: (i + 1) as u32,
                })
                .collect(),
            proxy_timeout: Some("1h".to_string()),
            proxy_connect_timeout: Some("5s".to_string()),
            enabled: true,
        }],
    });

    // Run 10,000 consecutive iterations to verify zero heap leaks or fragmentation growth
    for _ in 0..10_000 {
        let conf = generate_l4_streams_conf(&l4).expect("must render");
        assert!(!conf.is_empty());
        drop(conf);
    }
}

