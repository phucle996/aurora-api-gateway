//! Declarative Configuration & Policy for Response Compression
//!
//! Strongly-typed schema supporting multi-algorithm preference, per-route overrides,
//! and RFC 6838 MIME sanitization.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Individual route override rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteCompressionOverride {
    pub path_prefix: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub min_length: Option<usize>,
    #[serde(default)]
    pub prefer_algorithms: Option<Vec<String>>,
}

/// Global configuration for response compression.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResponseCompressionConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,

    #[serde(default = "default_min_length")]
    pub min_length: usize,

    #[serde(default = "default_prefer_algorithms")]
    pub prefer_algorithms: Vec<String>,

    #[serde(default = "default_zstd_level")]
    pub zstd_level: u32,

    #[serde(default = "default_brotli_level")]
    pub brotli_level: u32,

    #[serde(default = "default_gzip_level")]
    pub gzip_level: u32,

    #[serde(default = "default_types")]
    pub types: Vec<String>,

    #[serde(default)]
    pub routes_override: Vec<RouteCompressionOverride>,
}

fn default_enabled() -> bool {
    true
}

fn default_min_length() -> usize {
    1024
}

fn default_prefer_algorithms() -> Vec<String> {
    vec!["zstd".into(), "br".into(), "gzip".into()]
}

fn default_zstd_level() -> u32 {
    3
}

fn default_brotli_level() -> u32 {
    4
}

fn default_gzip_level() -> u32 {
    4
}

pub fn default_types() -> Vec<String> {
    vec![
        "application/json".into(),
        "text/plain".into(),
        "text/css".into(),
        "application/javascript".into(),
        "text/xml".into(),
        "application/xml".into(),
        "application/xml+rss".into(),
        "text/javascript".into(),
        "image/svg+xml".into(),
        "application/graphql+json".into(),
    ]
}

impl Default for ResponseCompressionConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            min_length: default_min_length(),
            prefer_algorithms: default_prefer_algorithms(),
            zstd_level: default_zstd_level(),
            brotli_level: default_brotli_level(),
            gzip_level: default_gzip_level(),
            types: default_types(),
            routes_override: Vec::new(),
        }
    }
}

/// Validates whether a character is an RFC 6838 restricted-name-first / restricted-name-subsequent char.
#[inline(always)]
fn is_valid_mime_char(b: u8) -> bool {
    b.is_ascii_alphanumeric()
        || b == b'!'
        || b == b'#'
        || b == b'$'
        || b == b'&'
        || b == b'-'
        || b == b'^'
        || b == b'_'
        || b == b'.'
        || b == b'+'
}

/// Strictly validates an individual MIME type against RFC 6838 specification or wildcard `*`.
pub fn validate_mime_type(mime: &str) -> Result<String, String> {
    if mime.bytes().any(|b| b == b'\r' || b == b'\n' || b == b'\0' || b == b';' || b == b'{' || b == b'}') {
        return Err(format!(
            "MIME type '{mime}' contains forbidden control or delimiter characters"
        ));
    }

    let trimmed = mime.trim();
    if trimmed.is_empty() {
        return Err("MIME type cannot be empty".to_string());
    }
    if trimmed == "*" {
        return Ok("*".to_string());
    }
    if trimmed.len() > 64 {
        return Err(format!("MIME type '{trimmed}' exceeds maximum 64 characters"));
    }

    let bytes = trimmed.as_bytes();
    let slash_pos = bytes.iter().position(|&b| b == b'/');
    let Some(slash_idx) = slash_pos else {
        return Err(format!(
            "MIME type '{trimmed}' must contain exactly one '/' separator"
        ));
    };

    if slash_idx == 0 || slash_idx == bytes.len() - 1 {
        return Err(format!("MIME type '{trimmed}' has empty type or subtype"));
    }

    if bytes[slash_idx + 1..].contains(&b'/') {
        return Err(format!(
            "MIME type '{trimmed}' contains multiple '/' separators"
        ));
    }

    for (i, &b) in bytes.iter().enumerate() {
        if i == slash_idx {
            continue;
        }
        if !is_valid_mime_char(b) {
            return Err(format!(
                "MIME type '{trimmed}' contains invalid character 0x{b:02X}"
            ));
        }
    }

    Ok(trimmed.to_ascii_lowercase())
}

impl ResponseCompressionConfig {
    /// Validates all configuration invariants.
    pub fn validate(&self) -> Result<(), String> {
        if self.min_length < 20 || self.min_length > 10_485_760 {
            return Err(format!(
                "min_length {} is out of range (must be 20 to 10485760 bytes)",
                self.min_length
            ));
        }

        if !(1..=19).contains(&self.zstd_level) {
            return Err(format!("zstd_level {} must be 1..=19", self.zstd_level));
        }

        if !(1..=11).contains(&self.brotli_level) {
            return Err(format!("brotli_level {} must be 1..=11", self.brotli_level));
        }

        if !(1..=9).contains(&self.gzip_level) {
            return Err(format!("gzip_level {} must be 1..=9", self.gzip_level));
        }

        if self.prefer_algorithms.is_empty() {
            return Err("prefer_algorithms cannot be empty".to_string());
        }

        for algo in &self.prefer_algorithms {
            let lower = algo.trim().to_ascii_lowercase();
            if lower != "zstd" && lower != "br" && lower != "brotli" && lower != "gzip" {
                return Err(format!("unsupported compression algorithm '{algo}' (allowed: zstd, br, gzip)"));
            }
        }

        if self.types.len() > 64 {
            return Err(format!(
                "MIME types count {} exceeds maximum 64",
                self.types.len()
            ));
        }

        for mime in &self.types {
            validate_mime_type(mime)?;
        }

        for route in &self.routes_override {
            if !route.path_prefix.starts_with('/') {
                return Err(format!("route override path_prefix '{}' must start with '/'", route.path_prefix));
            }
            if let Some(ml) = route.min_length
                && !(20..=10_485_760).contains(&ml)
            {
                return Err(format!("route min_length {ml} out of range (20..=10485760)"));
            }
            if let Some(algos) = &route.prefer_algorithms {
                for algo in algos {
                    let lower = algo.trim().to_ascii_lowercase();
                    if lower != "zstd" && lower != "br" && lower != "brotli" && lower != "gzip" {
                        return Err(format!("unsupported algorithm in route override: '{algo}'"));
                    }
                }
            }
        }

        Ok(())
    }

    /// Returns deduplicated list of allowed MIME types.
    pub fn sanitized_types(&self) -> Vec<String> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::with_capacity(self.types.len());

        for raw in &self.types {
            if let Ok(clean) = validate_mime_type(raw) {
                if !seen.insert(clean.clone()) {
                    continue;
                }
                result.push(clean);
            }
        }

        result
    }
}
