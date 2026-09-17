use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MetricsExtensionSpec {
    #[serde(default = "default_metrics_port")]
    pub port: u16,
    #[serde(default)]
    pub prometheus: Option<PrometheusSpec>,
    #[serde(default)]
    pub otlp: Option<OtlpSpec>,
}

impl Default for MetricsExtensionSpec {
    fn default() -> Self {
        Self {
            port: default_metrics_port(),
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
#[serde(deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct OtlpSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default = "default_otlp_protocol")]
    pub protocol: String,
    #[serde(default = "default_otlp_interval")]
    pub interval_secs: u64,
    #[serde(default = "default_otlp_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_otlp_service_name")]
    pub service_name: String,
}

impl Default for OtlpSpec {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: String::new(),
            protocol: default_otlp_protocol(),
            interval_secs: default_otlp_interval(),
            timeout_ms: default_otlp_timeout(),
            service_name: default_otlp_service_name(),
        }
    }
}

fn default_otlp_interval() -> u64 {
    15
}

fn default_otlp_protocol() -> String {
    "http".to_string()
}

fn default_otlp_timeout() -> u64 {
    5000
}

fn default_otlp_service_name() -> String {
    "aurora-gateway".to_string()
}
