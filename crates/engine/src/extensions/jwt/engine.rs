use super::crypto::{compile_keys, parse_algorithm, path_matches, valid_host, valid_path_prefix};
use super::types::{
    CompiledForwardHeader, JwtDecision, MAX_AUTHORIZATION_BYTES, MAX_EXCLUDE_PATHS_PER_ORIGIN,
    MAX_FORWARD_HEADERS_PER_ORIGIN, MAX_JWT_ORIGINS, MAX_JWT_POLICY_BYTES, OriginPolicy, Snapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use jsonwebtoken::{Validation, decode, decode_header};
use regex::Regex;
use std::collections::HashSet;

/// Immutable, request-safe JWT engine snapshot.
pub struct JwtEngine {
    generation: u64,
    origins: Vec<OriginPolicy>,
}

impl JwtEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_JWT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let snapshot: Snapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        let mut origins_list = if !snapshot.origins.is_empty() {
            snapshot.origins
        } else {
            snapshot.rules
        };
        if snapshot.schema_version != 1
            || snapshot.generation == 0
            || snapshot.generation > i64::MAX as u64
            || origins_list.is_empty()
            || origins_list.len() > MAX_JWT_ORIGINS
        {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = HashSet::with_capacity(origins_list.len());
        for origin in &origins_list {
            if origin.id.trim().is_empty() || origin.id.len() > 128 || !ids.insert(origin.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }
        origins_list.sort_by_key(|o| {
            (o.priority, host_specificity(o.host()), o.id.clone())
        });

        let mut origins = Vec::with_capacity(origins_list.len());
        for origin in origins_list {
            let host_bytes = origin.host().as_bytes().to_vec();
            if !valid_host(origin.host())
                || !valid_path_prefix(&origin.path_prefix)
                || origin.exclude_paths.len() > MAX_EXCLUDE_PATHS_PER_ORIGIN
                || origin.forward_headers.len() > MAX_FORWARD_HEADERS_PER_ORIGIN
                || origin.issuer.len() > 512
                || origin.audience.len() > 512
                || origin.clock_skew_secs > 300
            {
                return Err(Error::InvalidPolicy);
            }

            let mut exclude_paths = Vec::with_capacity(origin.exclude_paths.len());
            for ex in &origin.exclude_paths {
                if !valid_path_prefix(ex) {
                    return Err(Error::InvalidPolicy);
                }
                exclude_paths.push(ex.as_bytes().to_vec());
            }

            let alg = parse_algorithm(&origin.algorithm)?;
            let mut validation = Validation::new(alg);
            validation.leeway = origin.clock_skew_secs;
            validation.validate_nbf = true;
            if !origin.issuer.is_empty() {
                validation.set_issuer(&[origin.issuer]);
                validation.required_spec_claims.insert("iss".to_string());
            }
            if !origin.audience.is_empty() {
                validation.set_audience(&[origin.audience]);
                validation.required_spec_claims.insert("aud".to_string());
            }

            let (primary_key, keys_by_kid) =
                compile_keys(alg, &origin.secret, &origin.public_key_pem, &origin.keys)?;

            let mut forward_headers = Vec::with_capacity(origin.forward_headers.len());
            for fwd in origin.forward_headers {
                if fwd.payload_key.trim().is_empty()
                    || fwd.payload_key.len() > 64
                    || fwd.header_key.trim().is_empty()
                    || fwd.header_key.len() > 64
                {
                    return Err(Error::InvalidPolicy);
                }
                let regex = if fwd.value == "*" || fwd.value.trim().is_empty() {
                    None
                } else {
                    Some(Regex::new(&fwd.value).map_err(|_| Error::InvalidPolicy)?)
                };
                forward_headers.push(CompiledForwardHeader {
                    payload_key: fwd.payload_key,
                    header_key: fwd.header_key,
                    regex,
                });
            }

            origins.push(OriginPolicy {
                host: host_bytes,
                path_prefix: origin.path_prefix.into_bytes(),
                exclude_paths,
                validation,
                primary_key,
                keys_by_kid,
                forward_headers,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            origins,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate(
        &self,
        host: &[u8],
        path: &[u8],
        authorization: Option<&[u8]>,
    ) -> Result<JwtDecision, Error> {
        if host.len() > 253
            || host.contains(&0)
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || path[0] != b'/'
            || path.contains(&0)
        {
            return Err(Error::InvalidRequest);
        }

        let Some(origin) = self
            .origins
            .iter()
            .find(|o| host_matches(&o.host, host) && path_matches(&o.path_prefix, path))
        else {
            return Ok(JwtDecision::Allow {
                forwarded_headers: Vec::new(),
            });
        };

        // Check exclude_paths (Default-Deny bypass list)
        if origin.exclude_paths.iter().any(|ex| path_matches(ex, path)) {
            return Ok(JwtDecision::Allow {
                forwarded_headers: Vec::new(),
            });
        }

        let Some(authorization) = authorization else {
            return Ok(JwtDecision::Unauthorized);
        };
        if authorization.len() > MAX_AUTHORIZATION_BYTES
            || authorization.len() <= 7
            || !authorization[..6].eq_ignore_ascii_case(b"bearer")
            || authorization[6] != b' '
        {
            return Ok(JwtDecision::Unauthorized);
        }
        let token = &authorization[7..];
        if token.iter().any(|byte| byte.is_ascii_whitespace()) {
            return Ok(JwtDecision::Unauthorized);
        }
        let token_str = std::str::from_utf8(token).map_err(|_| Error::InvalidRequest)?;

        // O(1) Key Ring lookup by kid from header
        let decoding_key = if let Ok(header) = decode_header(token_str) {
            if let Some(ref kid) = header.kid {
                origin.keys_by_kid.get(kid).unwrap_or(&origin.primary_key)
            } else {
                &origin.primary_key
            }
        } else {
            &origin.primary_key
        };

        match decode::<serde_json::Value>(token_str, decoding_key, &origin.validation) {
            Ok(token_data) => {
                let mut forwarded_headers = Vec::new();
                if !origin.forward_headers.is_empty() {
                    if let Some(payload_obj) = token_data.claims.as_object() {
                        for fwd in &origin.forward_headers {
                            if let Some(val) = payload_obj.get(&fwd.payload_key) {
                                let val_str = match val {
                                    serde_json::Value::String(s) => s.clone(),
                                    serde_json::Value::Number(n) => n.to_string(),
                                    serde_json::Value::Bool(b) => b.to_string(),
                                    other => other.to_string(),
                                };
                                let matched = match fwd.regex {
                                    Some(ref re) => re.is_match(&val_str),
                                    None => true,
                                };
                                if matched {
                                    forwarded_headers.push((fwd.header_key.clone(), val_str));
                                }
                            }
                        }
                    }
                }
                Ok(JwtDecision::Allow { forwarded_headers })
            }
            Err(_) => Ok(JwtDecision::Unauthorized),
        }
    }
}
