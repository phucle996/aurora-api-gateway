use serde::Deserialize;

pub const MAX_REQUEST_TERMINATION_RULES: usize = 64;
pub const MAX_REQUEST_TERMINATION_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Deserialize, Clone, Debug)]
pub struct HeaderPairInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestTerminationRuleInput {
    #[serde(default = "default_rule_id")]
    pub id: String,
    #[serde(default = "default_priority")]
    pub priority: u32,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default = "default_status_code")]
    pub status_code: u16,
    #[serde(default = "default_content_type")]
    pub content_type: String,
    #[serde(default = "default_body")]
    pub body: String,
    #[serde(default)]
    pub headers: Vec<HeaderPairInput>,
    #[serde(default)]
    pub bypass_headers: Vec<HeaderPairInput>,
}

fn default_rule_id() -> String {
    "default".to_string()
}

fn default_priority() -> u32 {
    10
}

fn default_origin() -> String {
    "*".to_string()
}

fn default_path_prefix() -> String {
    "/".to_string()
}

fn default_status_code() -> u16 {
    503
}

fn default_content_type() -> String {
    "application/json; charset=utf-8".to_string()
}

fn default_body() -> String {
    r#"{"error":"Service temporarily unavailable"}"#.to_string()
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestTerminationSnapshot {
    pub schema_version: Option<u32>,
    pub generation: Option<u64>,
    pub status_code: Option<u16>,
    pub content_type: Option<String>,
    pub body: Option<String>,
    pub headers: Option<Vec<HeaderPairInput>>,
    pub bypass_headers: Option<Vec<HeaderPairInput>>,
    pub rules: Option<Vec<RequestTerminationRuleInput>>,
}

#[derive(Debug, Clone)]
pub struct TerminationDecision<'a> {
    pub matched: bool,
    pub should_terminate: bool,
    pub status_code: u16,
    pub content_type: &'a str,
    pub body: &'a str,
    pub headers: &'a [(String, String)],
    pub rule_id: &'a str,
}

impl<'a> Default for TerminationDecision<'a> {
    fn default() -> Self {
        Self {
            matched: false,
            should_terminate: false,
            status_code: 0,
            content_type: "",
            body: "",
            headers: &[],
            rule_id: "",
        }
    }
}
