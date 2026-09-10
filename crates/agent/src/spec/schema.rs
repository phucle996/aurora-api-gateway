use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::access::AccessSpec;
use super::certificate::CertificateSpec;
use super::extensions::ExtensionsSpec;
use super::routing::RoutingSpec;
use super::upstream::UpstreamSpec;
use super::waf::WafSpec;

/// Root Declarative Manifest representing the entire desired state of the cluster gateway.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Spec {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub release_id: u64,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub node_id: String,

    #[serde(default)]
    pub extensions: ExtensionsSpec,

    #[serde(default)]
    pub waf: WafSpec,

    #[serde(default)]
    pub access: AccessSpec,

    #[serde(default)]
    pub upstreams: Vec<UpstreamSpec>,

    #[serde(default)]
    pub upstreams_conf: Option<String>,

    #[serde(default)]
    pub routing: RoutingSpec,

    #[serde(default)]
    pub routing_conf: Option<String>,

    #[serde(default)]
    pub certificates: Vec<CertificateSpec>,
}

impl Spec {
    pub fn parse_yaml(raw: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(raw)
    }
}

/// Compute hex-encoded SHA-256 hash of byte slice.
pub fn compute_sha256(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spec_yaml_roundtrip() {
        let yaml = r#"
version: 1
release_id: 100
node_id: "node-01"
extensions:
  metrics:
    enabled: true
    port: 9145
    stub_status_url: "http://127.0.0.1:80/stub_status"
    prometheus:
      enabled: true
      path: "/metrics"
    otlp:
      enabled: true
      endpoint: "http://otel-collector:4317"
      interval_secs: 15
waf:
  mode: "enforce"
  block_paths:
    - "/blocked"
    - "/__aurora_blocked"
upstreams:
  - name: "api_backend"
    servers:
      - addr: "10.0.0.1:8080"
        weight: 1
routing:
  domains:
    - host: "example.com"
      locations:
        - path: "/"
          upstream: "api_backend"
"#;

        let spec = Spec::parse_yaml(yaml).expect("parse yaml");
        assert_eq!(spec.release_id, 100);
        assert_eq!(spec.node_id, "node-01");
        assert!(spec.extensions.prometheus.is_some());
        let metrics = spec.extensions.prometheus.as_ref().unwrap();
        assert!(metrics.enabled);
        assert_eq!(metrics.port, 9145);
        assert_eq!(
            metrics.stub_status_url.as_deref(),
            Some("http://127.0.0.1:80/stub_status")
        );
        assert_eq!(spec.waf.block_paths.len(), 2);
        assert_eq!(spec.upstreams.len(), 1);
        assert_eq!(spec.routing.domains.len(), 1);

        let hash1 = compute_sha256(yaml.as_bytes());
        let hash2 = compute_sha256(yaml.as_bytes());
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);
    }
}
