use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "aurora-agent",
    about = "Aurora API Gateway Dataplane Supervisor and Node Agent"
)]
pub struct Config {
    #[arg(long, env = "CONTROLLER_URL")]
    pub controller_url: String,

    #[arg(long, env = "NODE_ID")]
    pub node_id: String,

    #[arg(long, env = "AUTH_TOKEN")]
    pub auth_token: String,

    #[arg(long, env = "NGINX_BIN")]
    pub nginx_bin: PathBuf,

    #[arg(long, env = "NGINX_CONF")]
    pub nginx_conf: PathBuf,

    #[arg(long, env = "POLICY_DIR")]
    pub policy_dir: PathBuf,

    #[arg(long, env = "ROUTING_DIR")]
    pub routing_dir: PathBuf,

    #[arg(long, env = "MODULES_DIR")]
    pub modules_dir: PathBuf,

    #[arg(long, env = "HEARTBEAT_INTERVAL", default_value_t = 5)]
    pub heartbeat_interval_secs: u64,

    #[arg(long, env = "SYNC_INTERVAL", default_value_t = 3)]
    pub sync_interval_secs: u64,

    #[arg(long, env = "METRICS_PORT", default_value_t = 9145)]
    pub metrics_port: u16,

    #[arg(long, env = "METRICS_PROMETHEUS", default_value_t = false)]
    pub metrics_prometheus: bool,

    #[arg(long, env = "METRICS_OTLP_ENDPOINT")]
    pub metrics_otlp_endpoint: Option<String>,

    #[arg(
        long = "metrics-otlp-interval",
        env = "METRICS_OTLP_INTERVAL",
        default_value_t = 15
    )]
    pub metrics_otlp_interval_secs: u64,

    #[arg(long = "nginx-stub-status-url", env = "NGINX_STUB_STATUS_URL")]
    pub nginx_stub_status_url: Option<String>,

    #[arg(long, env = "NO_NGINX", default_value_t = false)]
    pub no_nginx: bool,

    #[arg(long, env = "GRPC_URL")]
    pub grpc_url: Option<String>,
}

impl Config {
    pub fn load() -> Self {
        let config = Self::parse();
        config.validate();
        config
    }

    pub fn grpc_endpoint(&self) -> String {
        if let Some(ref url) = self.grpc_url
            && !url.trim().is_empty()
        {
            return url.clone();
        }

        // Fallback from controller_url
        let base = self.controller_url.trim_end_matches('/');
        if let Some(idx) = base.rfind(':') {
            // Check if the part after ':' is digits (port)
            let suffix = &base[idx + 1..];
            if suffix.chars().all(|c| c.is_ascii_digit()) {
                return format!("{}:9090", &base[..idx]);
            }
        }
        format!("{}:9090", base)
    }

    pub fn validate(&self) {
        if self.controller_url.trim().is_empty() {
            panic!(
                "FATAL: CONTROLLER_URL is missing or empty. Provide via --controller-url or CONTROLLER_URL env var."
            );
        }
        if self.node_id.trim().is_empty() {
            panic!("FATAL: NODE_ID is missing or empty. Provide via --node-id or NODE_ID env var.");
        }
        if self.auth_token.trim().is_empty() {
            panic!(
                "FATAL: AUTH_TOKEN is missing or empty. Provide via --auth-token or AUTH_TOKEN env var."
            );
        }
        if self.nginx_bin.as_os_str().is_empty() {
            panic!(
                "FATAL: NGINX_BIN is missing or empty. Provide via --nginx-bin or NGINX_BIN env var."
            );
        }
        if self.nginx_conf.as_os_str().is_empty() {
            panic!(
                "FATAL: NGINX_CONF is missing or empty. Provide via --nginx-conf or NGINX_CONF env var."
            );
        }
        if self.policy_dir.as_os_str().is_empty() {
            panic!(
                "FATAL: POLICY_DIR is missing or empty. Provide via --policy-dir or POLICY_DIR env var."
            );
        }
        if self.routing_dir.as_os_str().is_empty() {
            panic!(
                "FATAL: ROUTING_DIR is missing or empty. Provide via --routing-dir or ROUTING_DIR env var."
            );
        }
        if self.modules_dir.as_os_str().is_empty() {
            panic!(
                "FATAL: MODULES_DIR is missing or empty. Provide via --modules-dir or MODULES_DIR env var."
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_required_flags() {
        let cfg = Config::try_parse_from([
            "aurora-agent",
            "--controller-url",
            "http://controller:8080",
            "--node-id",
            "node-01",
            "--auth-token",
            "secret-token",
            "--nginx-bin",
            "/opt/nginx/sbin/nginx",
            "--nginx-conf",
            "/etc/nginx/nginx.conf",
            "--policy-dir",
            "/var/lib/aurora-policy",
            "--routing-dir",
            "/var/lib/aurora-routing",
            "--modules-dir",
            "/opt/modules",
        ])
        .expect("parse config with all required flags");

        assert_eq!(cfg.controller_url, "http://controller:8080");
        assert_eq!(cfg.node_id, "node-01");
        assert_eq!(cfg.auth_token, "secret-token");
        assert_eq!(cfg.heartbeat_interval_secs, 5);
        assert_eq!(cfg.sync_interval_secs, 3);
        assert_eq!(cfg.metrics_port, 9145);
        assert!(!cfg.metrics_prometheus);
        assert!(cfg.metrics_otlp_endpoint.is_none());
        assert_eq!(cfg.metrics_otlp_interval_secs, 15);
        assert_eq!(cfg.nginx_stub_status_url, None);
        assert!(!cfg.no_nginx);
        cfg.validate();
    }

    #[test]
    fn test_metrics_flags() {
        let cfg = Config::try_parse_from([
            "aurora-agent",
            "--controller-url",
            "http://controller:8080",
            "--node-id",
            "node-01",
            "--auth-token",
            "secret-token",
            "--nginx-bin",
            "/nginx",
            "--nginx-conf",
            "/nginx.conf",
            "--policy-dir",
            "/policy",
            "--routing-dir",
            "/routing",
            "--modules-dir",
            "/modules",
            "--metrics-prometheus",
            "--metrics-otlp-endpoint",
            "http://otel-collector:4317",
            "--metrics-otlp-interval",
            "30",
            "--nginx-stub-status-url",
            "http://127.0.0.1:8080/stub_status",
        ])
        .expect("parse config with metrics flags");

        assert!(cfg.metrics_prometheus);
        assert_eq!(
            cfg.metrics_otlp_endpoint.as_deref(),
            Some("http://otel-collector:4317")
        );
        assert_eq!(cfg.metrics_otlp_interval_secs, 30);
        assert_eq!(
            cfg.nginx_stub_status_url.as_deref(),
            Some("http://127.0.0.1:8080/stub_status")
        );
    }

    #[test]
    fn test_missing_required_flags_fails() {
        let res = Config::try_parse_from(["aurora-agent"]);
        assert!(res.is_err());
    }

    #[test]
    #[should_panic(expected = "CONTROLLER_URL is missing or empty")]
    fn test_empty_controller_url_panics() {
        let cfg = Config {
            controller_url: "".to_string(),
            node_id: "node-01".to_string(),
            auth_token: "token".to_string(),
            nginx_bin: PathBuf::from("/nginx"),
            nginx_conf: PathBuf::from("/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            modules_dir: PathBuf::from("/modules"),
            heartbeat_interval_secs: 5,
            sync_interval_secs: 3,
            metrics_port: 9145,
            metrics_prometheus: false,
            metrics_otlp_endpoint: None,
            metrics_otlp_interval_secs: 15,
            nginx_stub_status_url: None,
            no_nginx: false,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    #[should_panic(expected = "AUTH_TOKEN is missing or empty")]
    fn test_empty_auth_token_panics() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            node_id: "node-01".to_string(),
            auth_token: "  ".to_string(),
            nginx_bin: PathBuf::from("/nginx"),
            nginx_conf: PathBuf::from("/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            modules_dir: PathBuf::from("/modules"),
            heartbeat_interval_secs: 5,
            sync_interval_secs: 3,
            metrics_port: 9145,
            metrics_prometheus: false,
            metrics_otlp_endpoint: None,
            metrics_otlp_interval_secs: 15,
            nginx_stub_status_url: None,
            no_nginx: false,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    fn test_grpc_endpoint_resolution() {
        let mut cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            node_id: "node-01".to_string(),
            auth_token: "token".to_string(),
            nginx_bin: PathBuf::from("/nginx"),
            nginx_conf: PathBuf::from("/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            modules_dir: PathBuf::from("/modules"),
            heartbeat_interval_secs: 5,
            sync_interval_secs: 3,
            metrics_port: 9145,
            metrics_prometheus: false,
            metrics_otlp_endpoint: None,
            metrics_otlp_interval_secs: 15,
            nginx_stub_status_url: None,
            no_nginx: false,
            grpc_url: None,
        };
        assert_eq!(cfg.grpc_endpoint(), "http://127.0.0.1:9090");

        cfg.grpc_url = Some("http://controller.aurora.local:9999".to_string());
        assert_eq!(cfg.grpc_endpoint(), "http://controller.aurora.local:9999");
    }
}
