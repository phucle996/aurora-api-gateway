use super::extensions::render_extensions;
use super::l4::generate_l4_streams_conf;
use super::routing::{find_matching_certificate, generate_domain_routing_conf, matches_sni};
use super::*;
use crate::spec::certificate::CertificateSpec;
use crate::spec::schema::Spec;
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn test_materialize_nginx_files() {
    let base_tmp = std::env::temp_dir().join(format!("aurora-spec-test-{}", std::process::id()));
    let policy_dir = base_tmp.join("policy");
    let routing_dir = base_tmp.join("routing");
    let _ = tokio::fs::remove_dir_all(&base_tmp).await;

    let spec = Spec {
        release_id: 99,
        waf: crate::spec::waf::WafSpec {
            mode: "enforce".to_string(),
            block_paths: vec!["/blocked".to_string()],
            ..Default::default()
        },
        upstreams: vec![crate::spec::upstream::UpstreamSpec {
            name: "backend".to_string(),
            servers: vec![crate::spec::upstream::UpstreamServerSpec {
                addr: "127.0.0.1:8080".to_string(),
                weight: 2,
            }],
        }],
        ..Default::default()
    };

    let res = materialize_nginx(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize");
    assert!(res.nginx_changed);

    assert!(policy_dir.join("active-policy.json").exists());
    assert!(policy_dir.join("active-access.json").exists());
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
    assert!(up_conf.contains("server 127.0.0.1:8080 weight=2 resolve;"));

    // Second run with same spec should NOT report changed
    let res2 = materialize_nginx(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize 2");
    assert!(!res2.nginx_changed);
}

#[test]
fn test_extensions_generation() {
    let digest = crate::extension::manifest::catalog_digest().unwrap();
    let extensions = vec![
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "rate-limit".to_string(),
            key: "builtin/rate-limit".to_string(),
            version: 1,
            manifest_digest: digest.clone(),
            config_json: r#"{"algorithm":"token_bucket","memory_size_mb":16,"max_keys":100000,"eviction_policy":"lru","overflow_strategy":"evict_and_track","rules":[{"id":"r1","host":"*","path_prefix":"/","limit_by":"client_ip","rate":50,"burst":100,"period_secs":1,"action_on_exceeded":"throttle","rejected_code":429}]}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "cors".to_string(),
            key: "builtin/cors".to_string(),
            version: 1,
            manifest_digest: digest.clone(),
            config_json: r#"{"allow_origins":["https://example.com"],"allow_methods":["GET","POST"],"allow_headers":["Authorization","Content-Type"],"allow_credentials":true,"max_age":3600}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "maintenance".to_string(),
            key: "builtin/maintenance-mode".to_string(),
            version: 1,
            manifest_digest: digest,
            config_json: r#"{"status_code":503,"bypass_header":"X-Bypass","retry_after_secs":120,"message":"Under upgrade"}"#.to_string(),
        },
        crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "jwt-authentication".to_string(),
            key: "builtin/jwt-authentication".to_string(),
            version: 1,
            manifest_digest: crate::extension::manifest::catalog_digest().unwrap(),
            config_json: r#"{"rules":[{"id":"api","host":"api.example.test","path_prefix":"/api","public_key_pem":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----","issuer":"https://issuer.example.test","audience":"gateway"}]}"#.to_string(),
        },
    ];
    let rendered = render_extensions(&extensions).unwrap();
    assert!(rendered.rate_limit_policy.is_some());

    let server_conf = rendered.server_conf;
    assert!(server_conf.contains("gateway_rate_limit_policy /var/lib/aurora-policy/active-rate-limit.json;"));
    assert!(
        server_conf.contains("add_header Access-Control-Allow-Origin \"$http_origin\" always;")
    );
    assert!(server_conf.contains("add_header Access-Control-Allow-Credentials \"true\" always;"));
    assert!(server_conf.contains("add_header Retry-After 120 always;"));
    assert!(server_conf.contains("if ($http_x_bypass)"));
    assert!(server_conf.contains("return 503 \"{\\\"error\\\":\\\"Under upgrade\\\"}\";"));
    assert!(server_conf.contains("gateway_jwt_policy /var/lib/aurora-policy/active-jwt.json;"));
    assert_eq!(
        rendered.jwt_policy.unwrap()["rules"][0]["host"],
        "api.example.test"
    );
}

#[tokio::test]
async fn test_jwt_extension_materializes_and_removes_ffi_snapshot() {
    let base = std::env::temp_dir().join(format!("aurora-jwt-materialize-{}", std::process::id()));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let digest = crate::extension::manifest::catalog_digest().unwrap();
    let spec = Spec {
        release_id: 91,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "jwt-authentication".to_string(),
            key: "builtin/jwt-authentication".to_string(),
            version: 1,
            manifest_digest: digest,
            config_json: r#"{"rules":[{"id":"api","host":"api.example.test","path_prefix":"/","public_key_pem":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----"}]}"#.to_string(),
        }],
        ..Default::default()
    };

    materialize_nginx(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize JWT snapshot");
    let jwt = tokio::fs::read_to_string(policy_dir.join("active-jwt.json"))
        .await
        .expect("read JWT snapshot");
    assert!(jwt.contains("\"generation\": 91"));
    assert!(jwt.contains("api.example.test"));

    let disabled = Spec {
        release_id: 92,
        ..Default::default()
    };
    let result = materialize_nginx(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove JWT snapshot");
    assert!(result.nginx_changed);
    assert!(!policy_dir.join("active-jwt.json").exists());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[tokio::test]
async fn test_rate_limit_extension_materializes_and_removes_ffi_snapshot() {
    let base = std::env::temp_dir().join(format!("materialize-rate-limit-snapshot-{}", std::process::id()));
    let policy_dir = base.join("policy");
    let routing_dir = base.join("routing");
    let _ = tokio::fs::remove_dir_all(&base).await;
    let digest = crate::extension::manifest::catalog_digest().unwrap();
    let spec = Spec {
        release_id: 88,
        extensions: vec![crate::spec::extensions::ExtensionInstanceSpec {
            instance_id: "rate-limit".to_string(),
            key: "builtin/rate-limit".to_string(),
            version: 1,
            manifest_digest: digest,
            config_json: r#"{"algorithm":"token_bucket","memory_size_mb":16,"max_keys":100000,"eviction_policy":"lru","overflow_strategy":"evict_and_track","rules":[{"id":"r1","host":"*","path_prefix":"/api","limit_by":"client_ip","rate":100,"period_secs":1,"action_on_exceeded":"throttle"}]}"#.to_string(),
        }],
        ..Default::default()
    };

    materialize_nginx(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize rate-limit snapshot");
    let rl = tokio::fs::read_to_string(policy_dir.join("active-rate-limit.json"))
        .await
        .expect("read rate-limit snapshot");
    assert!(rl.contains("\"generation\": 88"));
    assert!(rl.contains("\"token_bucket\""));
    assert!(rl.contains("\"/api\""));

    let disabled = Spec {
        release_id: 89,
        ..Default::default()
    };
    let result = materialize_nginx(&disabled, &policy_dir, &routing_dir)
        .await
        .expect("remove rate-limit snapshot");
    assert!(result.nginx_changed);
    assert!(!policy_dir.join("active-rate-limit.json").exists());
    let _ = tokio::fs::remove_dir_all(base).await;
}

#[test]
fn test_access_policy_renderer_generates_cidr_rules_from_instance_config() {
    let instance = crate::spec::extensions::ExtensionInstanceSpec {
        instance_id: "office-network".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        manifest_digest: crate::extension::manifest::catalog_digest().unwrap(),
        config_json: r#"{"whitelist":["198.51.100.0/24"],"blacklist":["192.0.2.10/32"],"rules":[{"id":"admin-block","cidr":"203.0.113.0/24","type":"blacklist","match_value":"/admin","action":"block","priority":7}]}"#.to_string(),
    };

    let rendered = render_extensions(&[instance]).unwrap();
    assert_eq!(rendered.access_rules.len(), 3);
    assert_eq!(rendered.access_rules[0]["action"], "allow");
    assert_eq!(rendered.access_rules[0]["priority"], 10);
    assert_eq!(rendered.access_rules[1]["action"], "block");
    assert_eq!(rendered.access_rules[2]["path_prefix"], "/admin");
    assert_eq!(rendered.access_rules[2]["priority"], 7);
    assert_eq!(rendered.access_rules[0]["networks"][0], "198.51.100.0/24");
}

#[test]
fn test_extension_renderer_rejects_catalog_digest_mismatch() {
    let instance = crate::spec::extensions::ExtensionInstanceSpec {
        instance_id: "ip-restriction".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        manifest_digest: "wrong-catalog".to_string(),
        config_json: r#"{"whitelist":[],"blacklist":[],"rules":[]}"#.to_string(),
    };
    assert!(render_extensions(&[instance]).is_err());
}

#[test]
fn test_access_policy_renderer_rejects_ipv4_mapped_ipv6() {
    let instance = crate::spec::extensions::ExtensionInstanceSpec {
        instance_id: "ip-restriction".to_string(),
        key: "builtin/ip-restriction".to_string(),
        version: 1,
        manifest_digest: crate::extension::manifest::catalog_digest().unwrap(),
        config_json: r#"{"whitelist":["::ffff:192.0.2.1/128"],"blacklist":[],"rules":[]}"#
            .to_string(),
    };
    assert!(render_extensions(&[instance]).is_err());
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
            domains: vec![
                crate::spec::routing::DomainRoutingSpec {
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
                            plugins_json: Some(r#"{"uri-rewrite":{"rules":[{"match_header":{"X-Test":"v1"},"rewrite_path":"/test"}]}}"#.to_string()),
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
                },
            ],
        },
        ..Default::default()
    };

    let temp_dir = std::path::PathBuf::from("/var/lib/aurora-routing");
    let conf = generate_domain_routing_conf(&spec, &temp_dir);

    // 1. Check HTTP server block
    assert!(conf.contains("server {\n    listen 80;\n    server_name api.aurora.local;"));

    // 2. Check HTTPS server block with mTLS
    assert!(conf.contains("server {\n    listen 443 ssl;\n    listen 127.0.0.1:9443 ssl proxy_protocol;\n    server_name api.aurora.local;"));
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

    // 7. Check URI Rewrite plugin
    assert!(conf.contains("if ($http_x_test = \"v1\")"));
    assert!(conf.contains("rewrite ^ /test break;"));
}

#[tokio::test]
async fn test_materialize_nginx_with_certificates() {
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

    let res = materialize_nginx(&spec, &policy_dir, &routing_dir)
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

    // L7 bridge assertions: the stream layer must preserve the original peer address.
    assert!(conf.contains("listen 8088;"));
    assert!(conf.contains("proxy_protocol on;"));
    assert!(conf.contains("proxy_pass 127.0.0.1:9082;"));
    assert!(!conf.contains("proxy_pass 127.0.0.1:80;"));

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
