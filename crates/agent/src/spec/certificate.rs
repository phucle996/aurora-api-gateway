use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CertificateSpec {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub snis: Vec<String>,
    #[serde(default)]
    pub cert_pem: String,
    #[serde(default)]
    pub key_pem: String,
    #[serde(default)]
    pub mtls_enabled: bool,
    #[serde(default)]
    pub client_ca_pem: String,
    #[serde(default = "default_verify_depth")]
    pub verify_depth: u32,
}

fn default_verify_depth() -> u32 {
    1
}
