use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub strip_path: bool,
    #[serde(default)]
    pub websocket: bool,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub plugins_json: Option<String>,
    #[serde(default)]
    pub origin_tls: Option<OriginTLSSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct OriginTLSSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub verify_cert: bool,
    #[serde(default)]
    pub sni_host: String,
    #[serde(default)]
    pub ca_cert: String,
    #[serde(default)]
    pub mtls: bool,
    #[serde(default)]
    pub client_cert: String,
    #[serde(default)]
    pub client_key: String,
}
