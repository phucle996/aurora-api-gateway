use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ExtensionsSpec {
    #[serde(default, alias = "metrics")]
    pub prometheus: Option<MetricsExtensionSpec>,
    #[serde(flatten, default)]
    pub dynamic: std::collections::HashMap<String, serde_yaml::Value>,
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
