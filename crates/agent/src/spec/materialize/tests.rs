use super::extensions::{generate_extensions_http_conf, generate_extensions_nginx_conf};
use super::l4::generate_l4_streams_conf;
use super::routing::{find_matching_certificate, generate_domain_routing_conf, matches_sni};
use super::*;
use crate::spec::certificate::CertificateSpec;
use crate::spec::schema::Spec;

#[tokio::test]
async fn test_materialize_nginx_files() {
    let base_tmp =
        std::env::temp_dir().join(format!("aurora-spec-test-{}", std::process::id()));
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
    assert!(up_conf.contains("server 127.0.0.1:8080 weight=2;"));

    // Second run with same spec should NOT report changed
    let res2 = materialize_nginx(&spec, &policy_dir, &routing_dir)
        .await
        .expect("materialize 2");
    assert!(!res2.nginx_changed);
}

#[test]
fn test_extensions_generation() {
    let mut extensions = std::collections::HashMap::new();

    // 1. Rate Limit
    let rl_yaml: serde_yaml::Value = serde_yaml::from_str(
        r#"
        enabled: true
        rate: 50
        burst: 100
        period_secs: 1
        rejected_code: 429
        "#,
    )
    .unwrap();
    extensions.insert("rate-limit".to_string(), rl_yaml);

    // 2. CORS
    let cors_yaml: serde_yaml::Value = serde_yaml::from_str(
        r#"
        enabled: true
        allow_origins: ["https://example.com"]
        allow_methods: ["GET", "POST"]
        allow_headers: ["Authorization", "Content-Type"]
        allow_credentials: true
        max_age: 3600
        "#,
    )
    .unwrap();
    extensions.insert("cors".to_string(), cors_yaml);

    // 3. Maintenance Mode
    let maint_yaml: serde_yaml::Value = serde_yaml::from_str(
        r#"
        enabled: true
        status_code: 503
        bypass_header: "X-Bypass"
        retry_after_secs: 120
        message: "Under upgrade"
        "#,
    )
    .unwrap();
    extensions.insert("maintenance-mode".to_string(), maint_yaml);

    let http_conf = generate_extensions_http_conf(&extensions);
    assert!(
        http_conf.contains(
            "limit_req_zone $binary_remote_addr zone=aurora_rate_limit:10m rate=50r/s;"
        )
    );

    let server_conf = generate_extensions_nginx_conf(&extensions);
    assert!(server_conf.contains("limit_req_status 429;"));
    assert!(server_conf.contains("limit_req zone=aurora_rate_limit burst=100 nodelay;"));
    assert!(
        server_conf.contains("add_header 'Access-Control-Allow-Origin' '$http_origin' always;")
    );
    assert!(
        server_conf.contains("add_header 'Access-Control-Allow-Credentials' 'true' always;")
    );
    assert!(server_conf.contains("add_header Retry-After 120 always;"));
    assert!(server_conf.contains("if ($http_x_bypass)"));
    assert!(server_conf.contains("return 503 '{\"error\":\"Under upgrade\"}';"));
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
                        },
                        crate::spec::routing::LocationRoutingSpec {
                            path: "/api/v1".to_string(),
                            upstream: "api_upstream_old".to_string(),
                            priority: 1,
                            strip_path: false,
                            websocket: false,
                            plugins_json: None,
                        },
                        // Higher priority route for same path /api/v1 -> overrides
                        crate::spec::routing::LocationRoutingSpec {
                            path: "/api/v1".to_string(),
                            upstream: "api_upstream_new".to_string(),
                            priority: 10,
                            strip_path: true,
                            websocket: false,
                            plugins_json: Some(r#"{"uri-rewrite":{"rules":[{"match_header":{"X-Test":"v1"},"rewrite_path":"/test"}]}}"#.to_string()),
                        },
                        crate::spec::routing::LocationRoutingSpec {
                            path: "/ws".to_string(),
                            upstream: "ws_upstream".to_string(),
                            priority: 5,
                            strip_path: false,
                            websocket: true,
                            plugins_json: None,
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
    assert!(conf.contains("server {\n    listen 443 ssl;\n    server_name api.aurora.local;"));
    assert!(conf.contains("ssl_certificate /var/lib/aurora-routing/certs/cert_123.crt;"));
    assert!(conf.contains("ssl_certificate_key /var/lib/aurora-routing/certs/cert_123.key;"));
    assert!(
        conf.contains("ssl_client_certificate /var/lib/aurora-routing/certs/cert_123_ca.crt;")
    );
    assert!(conf.contains("ssl_verify_client on;"));
    assert!(conf.contains("ssl_verify_depth 3;"));

    // 3. Check Deduplication & Priority: api_upstream_new won over api_upstream_old
    assert!(conf.contains("proxy_pass http://api_upstream_new;"));
    assert!(!conf.contains("proxy_pass http://api_upstream_old;"));

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

    // 7. Check URI Rewrite plugin
    assert!(conf.contains("if ($http_x_test = \"v1\")"));
    assert!(conf.contains("rewrite ^ /test break;"));
}

#[tokio::test]
async fn test_materialize_nginx_with_certificates() {
    let base_tmp =
        std::env::temp_dir().join(format!("aurora-cert-test-{}", std::process::id()));
    let policy_dir = base_tmp.join("policy");
    let routing_dir = base_tmp.join("routing");
    let _ = tokio::fs::remove_dir_all(&base_tmp).await;

    let spec = Spec {
        release_id: 101,
        certificates: vec![CertificateSpec {
            id: "test_cert_id".to_string(),
            name: "Test Cert".to_string(),
            snis: vec!["secure.aurora.local".to_string()],
            cert_pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"
                .to_string(),
            key_pem: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----".to_string(),
            client_ca_pem: "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----"
                .to_string(),
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

    assert!(cert_file.exists());
    assert!(key_file.exists());
    assert!(ca_file.exists());

    let cert_content = tokio::fs::read_to_string(&cert_file).await.unwrap();
    assert!(cert_content.contains("BEGIN CERTIFICATE"));

    let routing_conf =
        tokio::fs::read_to_string(routing_dir.join("active-domain-routing.conf"))
            .await
            .unwrap();
    assert!(routing_conf.contains("listen 443 ssl;"));
    assert!(routing_conf.contains("test_cert_id.crt"));
    assert!(routing_conf.contains("ssl_verify_client on;"));

    let _ = tokio::fs::remove_dir_all(&base_tmp).await;
}

#[test]
fn test_l4_streams_generation() {
    use crate::spec::l4::{L4AclRuleSpec, L4ServerSpec, L4ServiceSpec, L4Spec, L4UpstreamSpec};

    let l4 = Some(L4Spec {
        upstreams: vec![L4UpstreamSpec {
            name: "pg_cluster".to_string(),
            protocol: "tcp".to_string(),
            algorithm: "least_conn".to_string(),
            servers: vec![
                L4ServerSpec {
                    addr: "10.0.0.10:5432".to_string(),
                    weight: 2,
                    max_fails: Some(3),
                    fail_timeout: Some("10s".to_string()),
                },
            ],
        }],
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
                            cidr: "192.168.1.0/24".to_string(),
                            action: "allow".to_string(),
                        },
                        L4AclRuleSpec {
                            cidr: "0.0.0.0/0".to_string(),
                            action: "deny".to_string(),
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
            ],
        });

    let conf = generate_l4_streams_conf(&l4);
    assert!(conf.contains("upstream l4_pg_cluster {"));
    assert!(conf.contains("least_conn;"));
    assert!(conf.contains("server 10.0.0.10:5432 weight=2 max_fails=3 fail_timeout=10s;"));
    assert!(conf.contains("listen 5432;"));
    assert!(conf.contains("allow 192.168.1.0/24;"));
    assert!(conf.contains("deny 0.0.0.0/0;"));
    assert!(conf.contains("proxy_pass l4_pg_cluster;"));
    assert!(conf.contains("proxy_timeout 1h;"));
    assert!(conf.contains("proxy_connect_timeout 5s;"));

    // Direct endpoint assertions
    assert!(conf.contains("listen 6379;"));
    assert!(conf.contains("proxy_pass 10.0.0.99:6379;"));
    assert!(conf.contains("proxy_timeout 30m;"));
}
