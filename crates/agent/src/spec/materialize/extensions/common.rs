//! Shared utility functions for extension spec validation and NGINX directive materialization.
//!
//! Provides type-safe JSON extraction helpers for reading extension configurations from NodeSpec,
//! alongside strict sanitization routines designed to prevent NGINX configuration injection.
//! Directives emitted into `active-extensions.conf` and `active-extensions-http.conf` pass through
//! these sanitizers to reject control characters, delimiter injection, and malformed header names.

use serde_json::{Map, Value};

/// Extracts an unsigned 64-bit integer from a JSON object if present.
pub fn unsigned(config: &Map<String, Value>, field: &str) -> Option<u64> {
    config.get(field).and_then(Value::as_u64)
}

/// Extracts an unsigned 64-bit integer or returns a fallback default.
pub fn unsigned_or(config: &Map<String, Value>, field: &str, default: u64) -> u64 {
    unsigned(config, field).unwrap_or(default)
}

/// Extracts a boolean flag from a JSON object if present.
pub fn boolean(config: &Map<String, Value>, field: &str) -> Option<bool> {
    config.get(field).and_then(Value::as_bool)
}

/// Extracts a string slice from a JSON object if present.
pub fn string<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    config.get(field).and_then(Value::as_str)
}

/// Extracts a string slice or returns a fallback default as an owned String.
pub fn string_or(config: &Map<String, Value>, field: &str, default: &str) -> String {
    string(config, field).unwrap_or(default).to_string()
}

/// Extracts an array of strings from a JSON object, filtering out non-string items.
pub fn strings(config: &Map<String, Value>, field: &str) -> Option<Vec<String>> {
    config.get(field).and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(ToString::to_string)
            .collect()
    })
}

/// Extracts a nested JSON map from an object if present.
pub fn object<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a Map<String, Value>> {
    config.get(field).and_then(Value::as_object)
}

/// Extracts a nested JSON array from an object if present.
pub fn array<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a Vec<Value>> {
    config.get(field).and_then(Value::as_array)
}

/// Extracts a mandatory string field, returning an error if missing or not a string.
pub fn required_string<'a>(
    value: &'a Map<String, Value>,
    field: &str,
    owner: &str,
) -> Result<&'a str, String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{owner} requires string field {field}"))
}

/// Validates that an HTTP header name complies with RFC specifications and NGINX directive syntax.
///
/// Rejects empty names and names containing non-ASCII alphanumeric characters other than `-`
/// to prevent directive syntax breakage and header injection attacks.
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
///
/// Escapes backslashes and double quotes, while strictly rejecting CR, LF, and null bytes
/// to safeguard against HTTP response splitting and configuration injection.
pub fn nginx_quoted(value: &str, field: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(format!("{field} contains a prohibited control character"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

/// Validates an unquoted configuration fragment, rejecting NGINX block and statement delimiters.
///
/// Ensures fragments (such as rewrite regexes or replacement strings) do not contain `;`, `{`, `}`,
/// or newline control characters that could break out of the enclosing directive.
pub fn nginx_fragment<'a>(value: &'a str, field: &str) -> Result<&'a str, String> {
    if value.contains(['\r', '\n', '\0', ';', '{', '}']) {
        return Err(format!("{field} contains a prohibited NGINX delimiter"));
    }
    Ok(value)
}
