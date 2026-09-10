use serde::{Deserialize, Serialize};

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
