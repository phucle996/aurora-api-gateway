use serde_json::{Map, Value};

pub fn unsigned(config: &Map<String, Value>, field: &str) -> Option<u64> {
    config.get(field).and_then(Value::as_u64)
}

pub fn unsigned_or(config: &Map<String, Value>, field: &str, default: u64) -> u64 {
    unsigned(config, field).unwrap_or(default)
}

pub fn boolean(config: &Map<String, Value>, field: &str) -> Option<bool> {
    config.get(field).and_then(Value::as_bool)
}

pub fn string<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a str> {
    config.get(field).and_then(Value::as_str)
}

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

pub fn object<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a Map<String, Value>> {
    config.get(field).and_then(Value::as_object)
}

pub fn array<'a>(config: &'a Map<String, Value>, field: &str) -> Option<&'a Vec<Value>> {
    config.get(field).and_then(Value::as_array)
}

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

pub fn nginx_request_header_variable(header: &str) -> Result<String, String> {
    let header = nginx_header_name(header)?;
    Ok(format!(
        "$http_{}",
        header.to_ascii_lowercase().replace('-', "_")
    ))
}

pub fn nginx_quoted(value: &str, field: &str) -> Result<String, String> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(format!("{field} contains a prohibited control character"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

pub fn nginx_fragment<'a>(value: &'a str, field: &str) -> Result<&'a str, String> {
    if value.contains(['\r', '\n', '\0', ';', '{', '}']) {
        return Err(format!("{field} contains a prohibited NGINX delimiter"));
    }
    Ok(value)
}
