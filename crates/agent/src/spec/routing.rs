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
}
