use serde::Deserialize;

pub const MAX_REQUEST_MIRROR_RULES: usize = 64;
pub const MAX_REQUEST_MIRROR_POLICY_BYTES: usize = 131_072; // 128KB

#[derive(Deserialize, Clone, Debug)]
pub struct MirrorHeaderInput {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestMirrorRuleInput {
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
    pub primary_upstream: String,
    pub mirror_upstream: String,
    #[serde(default = "default_sample_percentage")]
    pub sample_percentage: u32,
    #[serde(default = "default_ignore_errors")]
    pub ignore_mirror_errors: bool,
    #[serde(default)]
    pub mirror_headers: Vec<MirrorHeaderInput>,
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

fn default_sample_percentage() -> u32 {
    100
}

fn default_ignore_errors() -> bool {
    true
}

#[derive(Deserialize, Clone, Debug)]
pub struct RequestMirrorSnapshot {
    pub schema_version: Option<u32>,
    pub generation: Option<u64>,
    pub rules: Option<Vec<RequestMirrorRuleInput>>,

    // Flat configuration format
    pub primary_upstream: Option<String>,
    pub mirror_upstream: Option<String>,
    pub sample_percentage: Option<u32>,
    pub ignore_mirror_errors: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MirrorDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub primary_upstream: &'a str,
    pub mirror_upstream: &'a str,
    pub is_mirrored: bool,
    pub mirror_headers: &'a [(String, String)],
}

impl<'a> MirrorDecision<'a> {
    pub const fn unmatched() -> MirrorDecision<'static> {
        MirrorDecision {
            matched: false,
            rule_id: "",
            primary_upstream: "",
            mirror_upstream: "",
            is_mirrored: false,
            mirror_headers: &[],
        }
    }

    pub const fn matched(
        rule_id: &'a str,
        primary_upstream: &'a str,
        mirror_upstream: &'a str,
        is_mirrored: bool,
        mirror_headers: &'a [(String, String)],
    ) -> Self {
        MirrorDecision {
            matched: true,
            rule_id,
            primary_upstream,
            mirror_upstream,
            is_mirrored,
            mirror_headers,
        }
    }
}
