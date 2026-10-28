use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::array;
use regex::Regex;
use serde_json::{Map, Value};

pub fn validate_jwt_config(
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
) -> Result<(), String> {
    let origins = array(config, "origins")
        .or_else(|| array(config, "rules"))
        .ok_or_else(|| {
            format!(
                "decode JWT extension {} config: origins must be an array",
                instance.instance_id
            )
        })?;
    if origins.is_empty() || origins.len() > 16 {
        return Err(format!(
            "JWT extension {} must contain 1..=16 origins",
            instance.instance_id
        ));
    }

    for (idx, origin) in origins.iter().enumerate() {
        let o_obj = origin.as_object().ok_or_else(|| {
            format!(
                "JWT extension {} origin #{idx} must be an object",
                instance.instance_id
            )
        })?;

        let id = o_obj
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "JWT extension {} origin #{idx} missing required non-empty 'id'",
                    instance.instance_id
                )
            })?;
        if id.len() > 128 {
            return Err(format!(
                "JWT extension {} origin '{id}' exceeds maximum 128 characters",
                instance.instance_id
            ));
        }

        let host = o_obj
            .get("host")
            .or_else(|| o_obj.get("origin"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "JWT extension {} origin '{id}' missing required non-empty 'host'",
                    instance.instance_id
                )
            })?;
        if host.len() > 253 {
            return Err(format!(
                "JWT extension {} origin '{id}' host exceeds maximum 253 characters",
                instance.instance_id
            ));
        }

        let path_prefix = o_obj
            .get("path_prefix")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "JWT extension {} origin '{id}' missing required 'path_prefix'",
                    instance.instance_id
                )
            })?;
        if !path_prefix.starts_with('/') {
            return Err(format!(
                "JWT extension {} origin '{id}' invalid 'path_prefix' '{path_prefix}': must start with '/'",
                instance.instance_id
            ));
        }

        let raw_alg = o_obj
            .get("algorithm")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "JWT extension {} origin '{id}' missing required 'algorithm'",
                    instance.instance_id
                )
            })?;
        let alg = raw_alg.to_ascii_uppercase();
        let is_symmetric = match alg.as_str() {
            "HS256" | "HS384" | "HS512" => true,
            "RS256" | "RS384" | "RS512" | "ES256" | "ES384" | "EDDSA" | "ED25519" => false,
            _ => {
                return Err(format!(
                    "JWT extension {} origin '{id}' unsupported algorithm '{raw_alg}'",
                    instance.instance_id
                ));
            }
        };

        let keys_arr = o_obj.get("keys").and_then(|v| v.as_array());
        if let Some(keys) = keys_arr {
            if keys.is_empty() || keys.len() > 8 {
                return Err(format!(
                    "JWT extension {} origin '{id}' 'keys' array must contain 1..=8 entries",
                    instance.instance_id
                ));
            }
        } else if is_symmetric {
            let secret = o_obj
                .get("secret")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    format!(
                        "JWT extension {} origin '{id}' algorithm '{alg}' requires non-empty 'secret'",
                        instance.instance_id
                    )
                })?;
            if secret.len() > 4096 {
                return Err(format!(
                    "JWT extension {} origin '{id}' secret exceeds maximum 4096 characters",
                    instance.instance_id
                ));
            }
        } else {
            let pem = o_obj
                .get("public_key_pem")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| {
                    format!(
                        "JWT extension {} origin '{id}' algorithm '{alg}' requires non-empty 'public_key_pem'",
                        instance.instance_id
                    )
                })?;
            if pem.len() > 8192 {
                return Err(format!(
                    "JWT extension {} origin '{id}' public_key_pem exceeds maximum 8192 characters",
                    instance.instance_id
                ));
            }
        }

        let ts = o_obj.get("token_source").ok_or_else(|| {
            format!(
                "JWT extension {} origin '{id}' missing required 'token_source' ('header' or 'cookie')",
                instance.instance_id
            )
        })?;

        match ts {
            Value::String(s) => {
                let s_lower = s.trim().to_ascii_lowercase();
                if s_lower != "header" && s_lower != "cookie" {
                    return Err(format!(
                        "JWT extension {} origin '{id}' invalid token_source '{s}': must be 'header' or 'cookie'",
                        instance.instance_id
                    ));
                }
                if s_lower == "cookie" {
                    if o_obj.get("header_name").is_some() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'cookie' cannot specify 'header_name'",
                            instance.instance_id
                        ));
                    }
                    let c_name = o_obj
                        .get("cookie_name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .unwrap_or("");
                    if c_name.is_empty() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'cookie' requires non-empty 'cookie_name'",
                            instance.instance_id
                        ));
                    }
                } else if s_lower == "header" {
                    if o_obj.get("cookie_name").is_some() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'header' cannot specify 'cookie_name'",
                            instance.instance_id
                        ));
                    }
                    let h_name = o_obj
                        .get("header_name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .unwrap_or("");
                    if h_name.is_empty() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'header' requires non-empty 'header_name'",
                            instance.instance_id
                        ));
                    }
                }
            }
            Value::Object(ts_obj) => {
                let source_type = ts_obj
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase();
                if source_type != "header" && source_type != "cookie" {
                    return Err(format!(
                        "JWT extension {} origin '{id}' invalid token_source type '{source_type}': must be 'header' or 'cookie'",
                        instance.instance_id
                    ));
                }
                if source_type == "cookie" {
                    let c_name = ts_obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .or_else(|| o_obj.get("cookie_name").and_then(|v| v.as_str()))
                        .map(|s| s.trim())
                        .unwrap_or("");
                    if c_name.is_empty() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'cookie' requires non-empty 'name'",
                            instance.instance_id
                        ));
                    }
                } else if source_type == "header" {
                    let h_name = ts_obj
                        .get("name")
                        .and_then(|v| v.as_str())
                        .or_else(|| o_obj.get("header_name").and_then(|v| v.as_str()))
                        .map(|s| s.trim())
                        .unwrap_or("");
                    if h_name.is_empty() {
                        return Err(format!(
                            "JWT extension {} origin '{id}' token_source 'header' requires non-empty 'name'",
                            instance.instance_id
                        ));
                    }
                }
            }
            _ => {
                return Err(format!(
                    "JWT extension {} origin '{id}' token_source must be a string or object",
                    instance.instance_id
                ));
            }
        }

        if let Some(paths) = o_obj.get("exclude_paths").and_then(|v| v.as_array()) {
            if paths.len() > 32 {
                return Err(format!(
                    "JWT extension {} origin '{id}' exceeds maximum 32 exclude_paths",
                    instance.instance_id
                ));
            }
            for (p_idx, p_val) in paths.iter().enumerate() {
                let p_str = p_val.as_str().map(|s| s.trim()).unwrap_or("");
                if p_str.is_empty() || !p_str.starts_with('/') {
                    return Err(format!(
                        "JWT extension {} origin '{id}' exclude_path #{p_idx} must start with '/'",
                        instance.instance_id
                    ));
                }
            }
        }

        if let Some(skew) = o_obj.get("clock_skew_secs").and_then(|v| v.as_i64())
            && !(0..=300).contains(&skew)
        {
            return Err(format!(
                "JWT extension {} origin '{id}' clock_skew_secs must be between 0 and 300",
                instance.instance_id
            ));
        }

        if let Some(claim_rules) = o_obj.get("claim_rules").and_then(|v| v.as_array()) {
            if claim_rules.len() > 32 {
                return Err(format!(
                    "JWT extension {} origin '{id}' exceeds maximum 32 claim_rules",
                    instance.instance_id
                ));
            }
            for (cr_idx, cr) in claim_rules.iter().enumerate() {
                let cr_obj = cr.as_object().ok_or_else(|| {
                    format!(
                        "JWT extension {} origin '{id}' claim_rule #{cr_idx} must be an object",
                        instance.instance_id
                    )
                })?;
                let payload_key = cr_obj
                    .get("payload_key")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} missing 'payload_key'",
                            instance.instance_id
                        )
                    })?;
                if payload_key.len() > 64 {
                    return Err(format!(
                        "JWT extension {} origin '{id}' claim_rule #{cr_idx} 'payload_key' too long (max 64)",
                        instance.instance_id
                    ));
                }

                if let Some(header_key) = cr_obj.get("header_key").and_then(|v| v.as_str()) {
                    let h_trimmed = header_key.trim();
                    if !h_trimmed.is_empty()
                        && (h_trimmed.len() > 64
                            || !h_trimmed
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
                    {
                        return Err(format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} invalid 'header_key' '{h_trimmed}'",
                            instance.instance_id
                        ));
                    }
                }

                if let Some(pattern) = cr_obj.get("values_match").and_then(|v| v.as_str())
                    && pattern != "*"
                    && !pattern.trim().is_empty()
                {
                    Regex::new(pattern).map_err(|e| {
                        format!(
                            "JWT extension {} origin '{id}' claim_rule #{cr_idx} invalid regex '{pattern}': {e}",
                            instance.instance_id
                        )
                    })?;
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_instance() -> ExtensionInstanceSpec {
        ExtensionInstanceSpec {
            instance_id: "jwt-test".to_string(),
            key: "builtin/jwt-authentication".to_string(),
            version: 1,
            renderer: "engine-jwt-rs256".to_string(),
            manifest_digest: String::new(),
            config_json: String::new(),
        }
    }

    #[test]
    fn test_validate_jwt_rejects_missing_algorithm() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","path_prefix":"/","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("missing required 'algorithm'"));
    }

    #[test]
    fn test_validate_jwt_rejects_missing_host() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","path_prefix":"/","algorithm":"HS256","secret":"s","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("missing required non-empty 'host'"));
    }

    #[test]
    fn test_validate_jwt_rejects_missing_path_prefix() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","algorithm":"HS256","secret":"s","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("missing required 'path_prefix'"));
    }

    #[test]
    fn test_validate_jwt_rejects_invalid_path_prefix() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","path_prefix":"api","algorithm":"HS256","secret":"s","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("must start with '/'"));
    }

    #[test]
    fn test_validate_jwt_rejects_missing_secret_for_hmac() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","path_prefix":"/","algorithm":"HS256","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("requires non-empty 'secret'"));
    }

    #[test]
    fn test_validate_jwt_rejects_missing_public_key_for_rsa() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","path_prefix":"/","algorithm":"RS256","token_source":"header","header_name":"Authorization"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("requires non-empty 'public_key_pem'"));
    }

    #[test]
    fn test_validate_jwt_rejects_missing_token_source() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{"id":"test","host":"api.local","path_prefix":"/","algorithm":"HS256","secret":"s"}]}"#,
        ).unwrap();
        let err = validate_jwt_config(&instance, &config).unwrap_err();
        assert!(err.contains("missing required 'token_source'"));
    }

    #[test]
    fn test_validate_jwt_accepts_valid_explicit_config() {
        let instance = test_instance();
        let config: Map<String, Value> = serde_json::from_str(
            r#"{"rules":[{
                "id":"prod-api",
                "host":"api.shop.local",
                "path_prefix":"/api",
                "algorithm":"RS256",
                "public_key_pem":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----",
                "token_source":"header",
                "header_name":"Authorization",
                "token_prefix":"Bearer ",
                "require_exp":true,
                "clock_skew_secs":60,
                "exclude_paths":["/api/healthz"]
            }]}"#,
        ).unwrap();
        assert!(validate_jwt_config(&instance, &config).is_ok());
    }
}
