use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AccessSpec {
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub rules: Vec<serde_json::Value>,
    #[serde(default)]
    pub raw_json: Option<String>,
}
