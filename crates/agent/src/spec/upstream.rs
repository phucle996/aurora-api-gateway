use serde::{Deserialize, Serialize};

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
