pub mod materialize;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Root Declarative Manifest representing the entire desired state of a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct NodeSpec {
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
}

impl NodeSpec {
    pub fn parse_yaml(raw: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(raw)
    }

    #[allow(dead_code)]
    pub fn to_yaml(&self) -> Result<String, serde_yaml::Error> {
        serde_yaml::to_string(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExtensionsSpec {
    #[serde(default)]
    pub metrics: Option<MetricsExtensionSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetricsExtensionSpec {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_metrics_port")]
    pub port: u16,
    #[serde(default)]
    pub stub_status_url: Option<String>,
    #[serde(default)]
    pub prometheus: Option<PrometheusSpec>,
    #[serde(default)]
    pub otlp: Option<OtlpSpec>,
}

impl Default for MetricsExtensionSpec {
    fn default() -> Self {
        Self {
            enabled: true,
            port: default_metrics_port(),
            stub_status_url: None,
            prometheus: Some(PrometheusSpec::default()),
            otlp: None,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_metrics_port() -> u16 {
    9145
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PrometheusSpec {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_metrics_path")]
    pub path: String,
}

impl Default for PrometheusSpec {
    fn default() -> Self {
        Self {
            enabled: true,
            path: default_metrics_path(),
        }
    }
}

fn default_metrics_path() -> String {
    "/metrics".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OtlpSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default = "default_otlp_interval")]
    pub interval_secs: u64,
}

fn default_otlp_interval() -> u64 {
    15
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WafSpec {
    #[serde(default = "default_waf_mode")]
    pub mode: String,
    #[serde(default)]
    pub block_paths: Vec<String>,
    #[serde(default)]
    pub rules: Vec<serde_json::Value>,
    #[serde(default)]
    pub raw_json: Option<String>,
}

impl Default for WafSpec {
    fn default() -> Self {
        Self {
            mode: default_waf_mode(),
            block_paths: Vec::new(),
            rules: Vec::new(),
            raw_json: None,
        }
    }
}

fn default_waf_mode() -> String {
    "enforce".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AccessSpec {
    #[serde(default)]
    pub rules: Vec<serde_json::Value>,
    #[serde(default)]
    pub raw_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct UpstreamSpec {
    pub name: String,
    #[serde(default)]
    pub servers: Vec<UpstreamServerSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct UpstreamServerSpec {
    pub addr: String,
    #[serde(default = "default_weight")]
    pub weight: u32,
}

fn default_weight() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct RoutingSpec {
    #[serde(default)]
    pub domains: Vec<DomainRoutingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct DomainRoutingSpec {
    pub host: String,
    #[serde(default)]
    pub locations: Vec<LocationRoutingSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct LocationRoutingSpec {
    pub path: String,
    pub upstream: String,
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
    fn test_node_spec_yaml_roundtrip() {
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

        let spec = NodeSpec::parse_yaml(yaml).expect("parse yaml");
        assert_eq!(spec.release_id, 100);
        assert_eq!(spec.node_id, "node-01");
        assert!(spec.extensions.metrics.is_some());
        let metrics = spec.extensions.metrics.as_ref().unwrap();
        assert!(metrics.enabled);
        assert_eq!(metrics.port, 9145);
        assert_eq!(metrics.stub_status_url.as_deref(), Some("http://127.0.0.1:80/stub_status"));
        assert_eq!(spec.waf.block_paths.len(), 2);
        assert_eq!(spec.upstreams.len(), 1);
        assert_eq!(spec.routing.domains.len(), 1);

        let hash1 = compute_sha256(yaml.as_bytes());
        let hash2 = compute_sha256(yaml.as_bytes());
        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);
    }
}
