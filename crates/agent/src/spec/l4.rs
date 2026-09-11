use serde::{Deserialize, Serialize};

/// L4Spec represents Layer 4 (TCP/UDP) transport proxying and ACL configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct L4Spec {
    #[serde(default)]
    pub upstreams: Vec<L4UpstreamSpec>,
    #[serde(default)]
    pub services: Vec<L4ServiceSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct L4UpstreamSpec {
    pub name: String,
    #[serde(default = "default_tcp")]
    pub protocol: String,
    #[serde(default = "default_round_robin")]
    pub algorithm: String,
    #[serde(default)]
    pub servers: Vec<L4ServerSpec>,
}

fn default_tcp() -> String {
    "tcp".to_string()
}

fn default_round_robin() -> String {
    "round_robin".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct L4ServerSpec {
    pub addr: String,
    #[serde(default = "default_weight")]
    pub weight: u32,
    #[serde(default)]
    pub max_fails: Option<u32>,
    #[serde(default)]
    pub fail_timeout: Option<String>,
}

fn default_weight() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct L4ServiceSpec {
    pub name: String,
    #[serde(default = "default_tcp")]
    pub protocol: String,
    pub listen_port: u16,
    #[serde(default)]
    pub forward_target_type: Option<String>,
    #[serde(default)]
    pub upstream: String,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub acl: Vec<L4AclRuleSpec>,
    #[serde(default)]
    pub proxy_timeout: Option<String>,
    #[serde(default)]
    pub proxy_connect_timeout: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct L4AclRuleSpec {
    pub cidr: String,
    pub action: String, // "allow" | "deny"
}
