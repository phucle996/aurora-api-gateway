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
}
