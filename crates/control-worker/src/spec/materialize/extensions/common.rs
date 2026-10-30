//! Package-local utility functions for extension spec validation and NGINX directive materialization.
//!
//! Enforces strict sanitization to prevent NGINX configuration injection. Directives emitted into
//! `active-extensions.conf` and `active-extensions-http.conf` pass through these sanitizers to reject
//! control characters, delimiter injection, and malformed header names.

use serde_json::{Map, Value};

#[inline]
pub fn unsigned(config: &Map<String, Value>, field: &str) -> Option<u64> {
    config.get(field).and_then(Value::as_u64)
}

#[inline]
pub fn unsigned_or(config: &Map<String, Value>, field: &str, default: u64) -> u64 {
    unsigned(config, field).unwrap_or(default)
}

#[inline]
pub fn boolean(config: &Map<String, Value>, field: &str) -> Option<bool> {
    config.get(field).and_then(Value::as_bool)
}

#[inline]
pub fn string<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    config.get(field).and_then(Value::as_str)
}

#[inline]
pub fn string_or(config: &Map<String, Value>, field: &str, default: &str) -> String {
    string(config, field).unwrap_or(default).to_string()
}

pub fn strings(config: &Map<String, Value>, field: &str) -> Option<Vec<String>> {
    config.get(field).and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect()
    })
}

#[inline]
pub fn object<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a Map<String, Value>> {
    config.get(field).and_then(Value::as_object)
}

/// Validates that an HTTP header name complies with RFC specifications and NGINX directive syntax.
pub fn nginx_header_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(format!("header name {name:?} is invalid"));
    }
    Ok(name)
}

/// Converts an HTTP header name into its corresponding NGINX `$http_<name>` variable representation.
pub fn nginx_request_header_variable(header: &str) -> Result<String, String> {
    let header = nginx_header_name(header)?;
    Ok(format!(
        "$http_{}",
        header.to_ascii_lowercase().replace('-', "_")
    ))
}

/// Quotes a string value for safe insertion into NGINX configuration directives.
pub fn nginx_quoted(value: &str, field: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(format!("{field} contains a prohibited control character"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
