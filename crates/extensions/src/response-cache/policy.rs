//! Response Cache Extension Configuration Policy.
//!
//! Provides granular caching rules, multi-variant compression settings,
//! and per-route overrides according to RFC 7234 & RFC 9110 specifications.

use serde::{Deserialize, Serialize};

/// Per-route cache behavior override.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteCacheOverride {
    pub path_prefix: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub ttl_secs: Option<u32>,
    #[serde(default)]
    pub cache_key_headers: Option<Vec<String>>,
}

/// Global response cache configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResponseCacheConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,

    #[serde(default = "default_ttl")]
    pub default_ttl_secs: u32,

    #[serde(default = "default_max_memory_mb")]
    pub max_memory_mb: usize,

    #[serde(default = "default_max_body_bytes")]
    pub max_body_bytes: usize,

    #[serde(default = "default_methods")]
    pub allowed_methods: Vec<String>,

    #[serde(default = "default_status_codes")]
    pub allowed_status_codes: Vec<u16>,

    #[serde(default)]
    pub cache_key_query_params: Option<Vec<String>>,

    #[serde(default)]
    pub cache_key_headers: Option<Vec<String>>,

    #[serde(default)]
    pub eager_compression: bool,

    #[serde(default)]
    pub routes_override: Vec<RouteCacheOverride>,
}

const fn default_true() -> bool {
    true
}

const fn default_ttl() -> u32 {
    300 // 5 minutes
}

const fn default_max_memory_mb() -> usize {
    256 // 256 MB
}

const fn default_max_body_bytes() -> usize {
    10 * 1024 * 1024 // 10 MB per response
}

fn default_methods() -> Vec<String> {
    vec!["GET".to_string(), "HEAD".to_string()]
}

fn default_status_codes() -> Vec<u16> {
    vec![200, 203, 300, 301, 302, 307, 308, 404]
}

impl Default for ResponseCacheConfig {
    fn default() -> Self {
        Self {
            enabled: default_true(),
            default_ttl_secs: default_ttl(),
            max_memory_mb: default_max_memory_mb(),
            max_body_bytes: default_max_body_bytes(),
            allowed_methods: default_methods(),
            allowed_status_codes: default_status_codes(),
            cache_key_query_params: None,
            cache_key_headers: None,
            eager_compression: false,
            routes_override: Vec::new(),
        }
    }
}

impl ResponseCacheConfig {
    /// Validates and normalizes policy bounds.
    pub fn sanitize(mut self) -> Self {
        if self.max_memory_mb < 4 {
            self.max_memory_mb = 4;
        }
        if self.default_ttl_secs == 0 {
            self.default_ttl_secs = 60;
        }
        if self.max_body_bytes == 0 {
            self.max_body_bytes = 1024 * 1024;
        }
        self
    }

    /// Fast-path check if HTTP method is cacheable.
    #[inline]
    pub fn is_method_cacheable(&self, method: &[u8]) -> bool {
        self.allowed_methods
            .iter()
            .any(|m| m.as_bytes().eq_ignore_ascii_case(method))
    }

    /// Fast-path check if HTTP status code is cacheable.
    #[inline]
    pub fn is_status_cacheable(&self, status: u16) -> bool {
        self.allowed_status_codes.contains(&status)
    }
}
