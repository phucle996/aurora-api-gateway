use super::*;

#[test]
fn test_render_extensions_correlation_id() {
    // Both request_id and trace_id enabled
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "corr-1".to_string(),
        key: "builtin/correlation-id".to_string(),
        version: 1,
        renderer: "correlation-id".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "request_id": {
                "enabled": true,
                "header_name": "X-Request-ID",
                "send_in_response": true,
                "include_in_access_log": true
            },
            "trace_id": {
                "enabled": true,
                "header_name": "traceparent",
                "send_in_response": false,
                "include_in_access_log": true
            }
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");
    assert!(
        rendered
            .server_conf
            .contains("set $aurora_req_id $request_id;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header X-Request-ID $request_id;")
    );
    assert!(
        rendered
            .server_conf
            .contains("add_header X-Request-ID $request_id always;")
    );
    assert!(
        rendered
            .server_conf
            .contains("set $aurora_trace_id 00-$request_id-$aurora_span_id-01;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header traceparent \"00-$request_id-$aurora_span_id-01\";")
    );
    // trace_id.send_in_response was false:
    assert!(!rendered.server_conf.contains("add_header traceparent"));

    // Only trace_id enabled, request_id disabled
    let instances_trace_only = vec![ExtensionInstanceSpec {
        instance_id: "corr-2".to_string(),
        key: "builtin/correlation-id".to_string(),
        version: 1,
        renderer: "correlation-id".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "request_id": {
                "enabled": false,
                "header_name": "X-Request-ID",
                "send_in_response": true,
                "include_in_access_log": true
            },
            "trace_id": {
                "enabled": true,
                "header_name": "X-Custom-Trace",
                "send_in_response": true,
                "include_in_access_log": false
            }
        })
        .to_string(),
    }];

    let rendered2 = render_extensions(&instances_trace_only).expect("render must succeed");
    assert!(!rendered2.server_conf.contains("$aurora_req_id"));
    assert!(!rendered2.server_conf.contains("X-Request-ID"));
    assert!(!rendered2.server_conf.contains("set $aurora_trace_id")); // include_in_access_log is false
    assert!(
        rendered2
            .server_conf
            .contains("proxy_set_header X-Custom-Trace \"00-$request_id-$aurora_span_id-01\";")
    );
    assert!(
        rendered2.server_conf.contains(
            "add_header X-Custom-Trace \"00-$request_id-$aurora_span_id-01\" always;"
        )
    );
}

#[test]
fn test_render_extensions_request_header_transform_denylist_and_add() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "transform-1".to_string(),
        key: "builtin/request-header-transform".to_string(),
        version: 1,
        renderer: "request-header-transform".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": true,
            "mode": "denylist",
            "remove_headers": ["traceparent", "X-Request-ID", "X-User-Id"],
            "add_headers": {
                "X-Gateway-Env": "production"
            }
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header traceparent \"\";")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header X-Request-ID \"\";")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header X-User-Id \"\";")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header X-Gateway-Env \"production\";")
    );
    assert!(
        !rendered
            .server_conf
            .contains("proxy_pass_request_headers off;")
    );
}

#[test]
fn test_render_extensions_request_header_transform_allowlist() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "transform-2".to_string(),
        key: "builtin/request-header-transform".to_string(),
        version: 1,
        renderer: "request-header-transform".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": true,
            "mode": "allowlist",
            "allowlist": ["authorization", "Content-Type", "X-Custom-Key"]
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");
    assert!(
        rendered
            .server_conf
            .contains("proxy_pass_request_headers off;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header Host $host;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header Content-Type $content_type;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header Content-Length $content_length;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header authorization $http_authorization;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header Content-Type $http_content_type;")
    );
    assert!(
        rendered
            .server_conf
            .contains("proxy_set_header X-Custom-Key $http_x_custom_key;")
    );
}

#[test]
fn test_render_extensions_request_header_transform_disabled() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "transform-3".to_string(),
        key: "builtin/request-header-transform".to_string(),
        version: 1,
        renderer: "request-header-transform".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": false,
            "mode": "denylist",
            "remove_headers": ["traceparent", "X-Request-ID"]
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");
    assert!(
        !rendered
            .server_conf
            .contains("proxy_set_header traceparent")
    );
    assert!(
        !rendered
            .server_conf
            .contains("proxy_set_header X-Request-ID")
    );
}

#[test]
fn test_render_extensions_request_header_transform_precedence() {
    let instances = vec![
        ExtensionInstanceSpec {
            instance_id: "corr-1".to_string(),
            key: "builtin/correlation-id".to_string(),
            version: 1,
            renderer: "correlation-id".to_string(),
            manifest_digest: String::new(),
            config_json: serde_json::json!({
                "request_id": {
                    "enabled": true,
                    "header_name": "X-Request-ID",
                    "send_in_response": true,
                    "include_in_access_log": true
                },
                "trace_id": {
                    "enabled": true,
                    "header_name": "traceparent",
                    "send_in_response": false,
                    "include_in_access_log": true
                }
            })
            .to_string(),
        },
        ExtensionInstanceSpec {
            instance_id: "transform-1".to_string(),
            key: "builtin/request-header-transform".to_string(),
            version: 1,
            renderer: "request-header-transform".to_string(),
            manifest_digest: String::new(),
            config_json: serde_json::json!({
                "enabled": true,
                "mode": "denylist",
                "remove_headers": ["X-User-Id"]
            })
            .to_string(),
        },
    ];

    let rendered = render_extensions(&instances).expect("render must succeed");

    let pos_transform = rendered
        .server_conf
        .find("proxy_set_header X-User-Id \"\";")
        .expect("transform directive must be present");
    let pos_correlation = rendered
        .server_conf
        .find("proxy_set_header X-Request-ID $request_id;")
        .expect("correlation directive must be present");

    assert!(
        pos_transform < pos_correlation,
        "request header transform (pos {pos_transform}) MUST be placed ahead of correlation-id (pos {pos_correlation})"
    );
}

#[test]
fn test_render_extensions_prometheus_dynamic_port_and_allowlist() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-main".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "port": 9145,
            "path": "/metrics",
            "allowlist": ["10.0.0.0/8", "127.0.0.1"]
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");

    assert!(rendered.http_conf.contains("listen 9145;"));
    assert!(rendered.http_conf.contains("allow 10.0.0.0/8;"));
    assert!(rendered.http_conf.contains("allow 127.0.0.1;"));
    assert!(rendered.http_conf.contains("deny all;"));
    assert!(rendered.http_conf.contains("location = /metrics {"));
    assert!(rendered.http_conf.contains("gateway_metrics;"));
    assert!(!rendered.server_conf.contains("gateway_metrics;"));
}

#[test]
fn test_render_extensions_prometheus_custom_path_and_cidrs() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-custom".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "prometheus".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "port": 19145,
            "path": "/internal/prometheus",
            "allowlist": ["192.168.1.50"]
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");

    assert!(rendered.http_conf.contains("listen 19145;"));
    assert!(rendered.http_conf.contains("allow 192.168.1.50;"));
    assert!(rendered.http_conf.contains("deny all;"));
    assert!(
        rendered
            .http_conf
            .contains("location = /internal/prometheus {")
    );
}

#[test]
fn test_render_extensions_prometheus_allow_all() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-all".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "port": 9145,
            "allowlist": ["0.0.0.0/0"]
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("render must succeed");

    assert!(rendered.http_conf.contains("listen 9145;"));
    assert!(rendered.http_conf.contains("allow all;"));
    assert!(!rendered.http_conf.contains("deny all;"));
}

#[test]
fn test_render_extensions_prometheus_requires_port() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-no-port".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "allowlist": ["127.0.0.1"]
        })
        .to_string(),
    }];

    let err = render_extensions(&instances).expect_err("missing port must fail");
    assert!(err.contains("requires 'port' to be explicitly configured"));
}

#[test]
fn test_render_extensions_prometheus_requires_allowlist() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-no-allowlist".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "port": 9145,
            "allowlist": []
        })
        .to_string(),
    }];

    let err = render_extensions(&instances).expect_err("empty allowlist must fail");
    assert!(err.contains("requires non-empty 'allowlist'"));
}

#[test]
fn test_render_extensions_prometheus_rejects_invalid_cidr() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-bad-cidr".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "port": 9145,
            "allowlist": ["not-an-ip-address"]
        })
        .to_string(),
    }];

    let err = render_extensions(&instances).expect_err("invalid IP must fail");
    assert!(err.contains("not a valid IP or CIDR"));
}

#[test]
fn test_render_extensions_prometheus_disabled_emits_no_server_block() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "prom-disabled".to_string(),
        key: "builtin/prometheus".to_string(),
        version: 1,
        renderer: "agent-metrics".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": false,
            "port": 9145,
            "allowlist": ["127.0.0.1"]
        })
        .to_string(),
    }];

    let rendered =
        render_extensions(&instances).expect("disabled extension should succeed with no-op");
    assert!(!rendered.http_conf.contains("listen 9145;"));
    assert!(!rendered.http_conf.contains("gateway_metrics;"));
    assert!(
        rendered
            .http_conf
            .contains("# No active HTTP-level extension directives")
    );
}

#[test]
fn test_render_extensions_std_log_lifecycle() {
    let instances = vec![ExtensionInstanceSpec {
        instance_id: "std-log-inst".to_string(),
        key: "builtin/std-log".to_string(),
        version: 1,
        renderer: "std-log".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": true,
            "format": "json"
        })
        .to_string(),
    }];

    let rendered = render_extensions(&instances).expect("enabled std-log should succeed");
    assert!(rendered.server_conf.contains("gateway_std_log on;"));

    let disabled_instances = vec![ExtensionInstanceSpec {
        instance_id: "std-log-disabled".to_string(),
        key: "builtin/std-log".to_string(),
        version: 1,
        renderer: "std-log".to_string(),
        manifest_digest: String::new(),
        config_json: serde_json::json!({
            "enabled": false
        })
        .to_string(),
    }];

    let disabled_rendered =
        render_extensions(&disabled_instances).expect("disabled std-log should succeed");
    assert!(disabled_rendered.server_conf.contains("gateway_std_log off;"));
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
