use serde::Deserialize;

fn default_path_prefix() -> String {
    "/".to_string()
}

fn default_wildcard() -> String {
    "*".to_string()
}

#[derive(Clone, Debug, Deserialize)]
pub struct IpRestrictionRule {
    pub id: u64,
    pub priority: u32,
    pub action: String,
    pub networks: Vec<String>,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default = "default_wildcard")]
    pub host: String,
    #[serde(default = "default_wildcard")]
    pub method: String,
    #[serde(default)]
    pub log: bool,
}

#[derive(Deserialize)]
pub struct IpRestrictionSnapshot {
    pub schema_version: u32,
    pub generation: u64,
    pub rules: Vec<IpRestrictionRule>,
}

pub struct IpRestrictionRequest<'a> {
    pub ip: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub now: u64,
}
