//! Response Cache Extension Configuration Policy.
//!
//! Provides granular caching rules, multi-variant compression settings,
//! and per-route overrides according to RFC 7234 & RFC 9110 specifications.

use serde::{Deserialize, Serialize};

// ============================================================================
// 1. Route Override Rule
// ============================================================================

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

// ============================================================================
// 2. Global Response Cache Configuration
// ============================================================================

/// Global response cache configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResponseCacheConfig {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    #[serde(default = "default_generation")]
    pub generation: u64,

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

// ============================================================================
// 3. Default Values
// ============================================================================

const fn default_schema_version() -> u32 {
    1
}

const fn default_generation() -> u64 {
    1
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
            schema_version: default_schema_version(),
            generation: default_generation(),
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

// ============================================================================
// 4. Policy Invariants Validation & Helper Methods
// ============================================================================

impl ResponseCacheConfig {
    /// Validates all configuration invariants according to RFC specifications.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "schema_version {} is invalid (must be 1)",
                self.schema_version
            ));
        }

        if self.generation < 1 {
            return Err(format!(
                "generation {} is invalid (must be >= 1)",
                self.generation
            ));
        }

        if self.max_memory_mb < 4 || self.max_memory_mb > 65_536 {
            return Err(format!(
                "max_memory_mb {} is out of range (must be 4 to 65536 MB)",
                self.max_memory_mb
            ));
        }

        if self.default_ttl_secs == 0 || self.default_ttl_secs > 864_000 {
            return Err(format!(
                "default_ttl_secs {} is out of range (must be 1 to 864000 seconds)",
                self.default_ttl_secs
            ));
        }

        if self.max_body_bytes < 1024 || self.max_body_bytes > 104_857_600 {
            return Err(format!(
                "max_body_bytes {} is out of range (must be 1024 to 104857600 bytes)",
                self.max_body_bytes
            ));
        }

        if self.allowed_methods.is_empty() {
            return Err("allowed_methods cannot be empty".to_string());
        }

        for m in &self.allowed_methods {
            let m_trim = m.trim();
            if m_trim.is_empty() || !m_trim.bytes().all(|b| b.is_ascii_alphabetic()) {
                return Err(format!("invalid HTTP method '{m}' in allowed_methods"));
            }
        }

        if self.allowed_status_codes.is_empty() {
            return Err("allowed_status_codes cannot be empty".to_string());
        }

        for &sc in &self.allowed_status_codes {
            if !(100..=599).contains(&sc) {
                return Err(format!("status code {sc} is out of HTTP range (100..=599)"));
            }
        }

        for route in &self.routes_override {
            if !route.path_prefix.starts_with('/') {
                return Err(format!(
                    "route override path_prefix '{}' must start with '/'",
                    route.path_prefix
                ));
            }
            if let Some(ttl) = route.ttl_secs
                && (ttl == 0 || ttl > 864_000)
            {
                return Err(format!(
                    "route override ttl_secs {ttl} out of range (1..=864000)"
                ));
            }
        }

        Ok(())
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
