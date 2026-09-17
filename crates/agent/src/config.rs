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

    #[arg(long, env = "HOSTNAME", default_value = "")]
    pub hostname: String,

    #[arg(long, env = "AUTH_TOKEN")]
    pub auth_token: String,

    #[arg(long, env = "GATEWAY_BIN")]
    pub gateway_bin: PathBuf,

    #[arg(long, env = "GATEWAY_CONF")]
    pub gateway_conf: PathBuf,

    #[arg(long, env = "POLICY_DIR")]
    pub policy_dir: PathBuf,

    #[arg(long, env = "ROUTING_DIR")]
    pub routing_dir: PathBuf,

    #[arg(long, env = "SYNC_INTERVAL", default_value_t = 3)]
    pub sync_interval_secs: u64,

    #[arg(long, env = "GRPC_URL")]
    pub grpc_url: Option<String>,
}

fn get_system_hostname() -> Option<String> {
    let mut buf = [0u8; 256];
    let res = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if res == 0 {
        let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        std::str::from_utf8(&buf[..len]).ok().map(|s| s.to_string())
    } else {
        None
    }
}

impl Config {
    pub fn load() -> Self {
        let mut config = Self::parse();
        if config.hostname.trim().is_empty() {
            config.hostname = Self::resolve_hostname();
        }
        config.validate();
        config
    }

    /// Resolve gateway instance hostname:
    /// 1. HOSTNAME env var (Kubernetes pod name / Docker container name)
    /// 2. OS System Hostname via libc gethostname
    /// 3. Fallback: generate gateway-<uuid>
    pub fn resolve_hostname() -> String {
        if let Ok(val) = std::env::var("HOSTNAME") {
            let trimmed = val.trim();
            if !trimmed.is_empty() && trimmed != "localhost" {
                return trimmed.to_string();
            }
        }
        if let Some(host) = get_system_hostname() {
            let trimmed = host.trim();
            if !trimmed.is_empty() && trimmed != "localhost" {
                return trimmed.to_string();
            }
        }
        format!("gateway-{}", uuid::Uuid::new_v4().simple())
    }

    /// Semantic accessor for the instance hostname
    pub fn hostname(&self) -> &str {
        &self.hostname
    }

    pub fn grpc_endpoint(&self) -> String {
        if let Some(ref url) = self.grpc_url
            && !url.trim().is_empty()
        {
            return url.trim().to_string();
        }

        // Fallback from controller_url
        let base = self.controller_url.trim().trim_end_matches('/');
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
        if self.hostname.trim().is_empty() {
            panic!(
                "FATAL: HOSTNAME is missing or empty. Provide via --hostname or HOSTNAME env var."
            );
        }
        if self.auth_token.trim().is_empty() {
            panic!(
                "FATAL: AUTH_TOKEN is missing or empty. Provide via --auth-token or AUTH_TOKEN env var."
            );
        }
        if self.gateway_bin.as_os_str().is_empty() {
            panic!(
                "FATAL: GATEWAY_BIN is missing or empty. Provide via --gateway-bin or GATEWAY_BIN env var."
            );
        }
        if self.gateway_conf.as_os_str().is_empty() {
            panic!(
                "FATAL: GATEWAY_CONF is missing or empty. Provide via --gateway-conf or GATEWAY_CONF env var."
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
            "--hostname",
            "gateway-01",
            "--auth-token",
            "secret-token",
            "--gateway-bin",
            "/usr/local/bin/aurora-gateway",
            "--gateway-conf",
            "/etc/nginx/nginx.conf",
            "--policy-dir",
            "/var/lib/aurora-policy",
            "--routing-dir",
            "/var/lib/aurora-routing",
        ])
        .expect("parse config with all required flags");

        assert_eq!(cfg.controller_url, "http://controller:8080");
        assert_eq!(cfg.hostname, "gateway-01");
        assert_eq!(cfg.auth_token, "secret-token");
        assert_eq!(
            cfg.gateway_bin,
            PathBuf::from("/usr/local/bin/aurora-gateway")
        );
        assert_eq!(cfg.gateway_conf, PathBuf::from("/etc/nginx/nginx.conf"));
        assert_eq!(cfg.sync_interval_secs, 3);
        assert!(cfg.grpc_url.is_none());
        cfg.validate();
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
            hostname: "gateway-01".to_string(),
            auth_token: "token".to_string(),
            gateway_bin: PathBuf::from("/usr/local/bin/aurora-gateway"),
            gateway_conf: PathBuf::from("/etc/nginx/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    #[should_panic(expected = "HOSTNAME is missing or empty")]
    fn test_empty_hostname_panics() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            hostname: "".to_string(),
            auth_token: "token".to_string(),
            gateway_bin: PathBuf::from("/usr/local/bin/aurora-gateway"),
            gateway_conf: PathBuf::from("/etc/nginx/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    #[should_panic(expected = "AUTH_TOKEN is missing or empty")]
    fn test_empty_auth_token_panics() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            hostname: "gateway-01".to_string(),
            auth_token: "  ".to_string(),
            gateway_bin: PathBuf::from("/usr/local/bin/aurora-gateway"),
            gateway_conf: PathBuf::from("/etc/nginx/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    #[should_panic(expected = "GATEWAY_BIN is missing or empty")]
    fn test_empty_gateway_bin_panics() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            hostname: "gateway-01".to_string(),
            auth_token: "token".to_string(),
            gateway_bin: PathBuf::from(""),
            gateway_conf: PathBuf::from("/etc/nginx/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    #[should_panic(expected = "GATEWAY_CONF is missing or empty")]
    fn test_empty_gateway_conf_panics() {
        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            hostname: "gateway-01".to_string(),
            auth_token: "token".to_string(),
            gateway_bin: PathBuf::from("/usr/local/bin/aurora-gateway"),
            gateway_conf: PathBuf::from(""),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        cfg.validate();
    }

    #[test]
    fn test_grpc_endpoint_resolution() {
        let mut cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            hostname: "gateway-01".to_string(),
            auth_token: "token".to_string(),
            gateway_bin: PathBuf::from("/usr/local/bin/aurora-gateway"),
            gateway_conf: PathBuf::from("/etc/nginx/nginx.conf"),
            policy_dir: PathBuf::from("/policy"),
            routing_dir: PathBuf::from("/routing"),
            sync_interval_secs: 3,
            grpc_url: None,
        };
        assert_eq!(cfg.grpc_endpoint(), "http://127.0.0.1:9090");

        cfg.grpc_url = Some("http://controller.aurora.local:9999".to_string());
        assert_eq!(cfg.grpc_endpoint(), "http://controller.aurora.local:9999");
    }

    #[test]
    fn test_hostname_flag() {
        let cfg = Config::try_parse_from([
            "aurora-agent",
            "--controller-url",
            "http://controller:8080",
            "--hostname",
            "gateway-worker-99",
            "--auth-token",
            "secret-token",
            "--gateway-bin",
            "/usr/local/bin/aurora-gateway",
            "--gateway-conf",
            "/etc/nginx/nginx.conf",
            "--policy-dir",
            "/policy",
            "--routing-dir",
            "/routing",
        ])
        .expect("parse config with hostname flag");

        assert_eq!(cfg.hostname, "gateway-worker-99");
        assert_eq!(cfg.hostname(), "gateway-worker-99");
    }

    #[test]
    fn test_resolve_hostname_generates_identifier() {
        let id = Config::resolve_hostname();
        assert!(!id.trim().is_empty());
        if id.starts_with("gateway-") {
            assert!(id.len() > 8);
        }
    }
}
