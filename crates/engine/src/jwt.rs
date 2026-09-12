//! In-process RS256 bearer-token authorization for the NGINX access phase.
//!
//! Rules and keys are parsed once when a NodeSpec is activated. Request-time
//! work is limited to choosing one scoped rule and verifying its signature.

use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode};
use serde::Deserialize;
use std::collections::HashSet;

const MAX_JWT_POLICY_BYTES: usize = 65_536;
const MAX_JWT_RULES: usize = 8;
const MAX_AUTHORIZATION_BYTES: usize = 16_384;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    generation: u64,
    rules: Vec<JwtRuleInput>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JwtRuleInput {
    id: String,
    #[serde(default)]
    priority: u32,
    host: String,
    path_prefix: String,
    public_key_pem: String,
    #[serde(default)]
    issuer: String,
    #[serde(default)]
    audience: String,
    #[serde(default)]
    clock_skew_secs: u64,
}

struct JwtRule {
    host: Vec<u8>,
    path_prefix: Vec<u8>,
    key: DecodingKey,
    validation: Validation,
}

/// Immutable, request-safe JWT snapshot. A missing scoped rule allows the
/// request through; a matching rule requires a valid bearer token.
pub struct JwtEngine {
    generation: u64,
    rules: Vec<JwtRule>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JwtDecision {
    Allow,
    Unauthorized,
}

impl JwtEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_JWT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let mut snapshot: Snapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        if snapshot.schema_version != 1
            || snapshot.generation == 0
            || snapshot.generation > i64::MAX as u64
            || snapshot.rules.is_empty()
            || snapshot.rules.len() > MAX_JWT_RULES
        {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = HashSet::with_capacity(snapshot.rules.len());
        for rule in &snapshot.rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }
        snapshot
            .rules
            .sort_by_key(|rule| (rule.priority, host_specificity(&rule.host), rule.id.clone()));

        let mut rules = Vec::with_capacity(snapshot.rules.len());
        for rule in snapshot.rules {
            if !valid_host(&rule.host)
                || !valid_path_prefix(&rule.path_prefix)
                || rule.public_key_pem.is_empty()
                || rule.public_key_pem.len() > 8_192
                || rule.public_key_pem.contains("PRIVATE KEY")
                || !matches!(
                    rule.public_key_pem.lines().next(),
                    Some("-----BEGIN PUBLIC KEY-----" | "-----BEGIN RSA PUBLIC KEY-----")
                )
                || rule.issuer.len() > 512
                || rule.audience.len() > 512
                || rule.clock_skew_secs > 300
            {
                return Err(Error::InvalidPolicy);
            }

            let key = DecodingKey::from_rsa_pem(rule.public_key_pem.as_bytes())
                .map_err(|_| Error::InvalidPolicy)?;
            let mut validation = Validation::new(Algorithm::RS256);
            validation.leeway = rule.clock_skew_secs;
            validation.validate_nbf = true;
            if !rule.issuer.is_empty() {
                validation.set_issuer(&[rule.issuer]);
                validation.required_spec_claims.insert("iss".to_string());
            }
            if !rule.audience.is_empty() {
                validation.set_audience(&[rule.audience]);
                validation.required_spec_claims.insert("aud".to_string());
            }
            rules.push(JwtRule {
                host: rule.host.into_bytes(),
                path_prefix: rule.path_prefix.into_bytes(),
                key,
                validation,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
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

        let Some(rule) = self
            .rules
            .iter()
            .find(|rule| host_matches(&rule.host, host) && path_matches(&rule.path_prefix, path))
        else {
            return Ok(JwtDecision::Allow);
        };

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
        match decode::<serde_json::Value>(token, &rule.key, &rule.validation) {
            Ok(_) => Ok(JwtDecision::Allow),
            Err(_) => Ok(JwtDecision::Unauthorized),
        }
    }
}

fn valid_host(host: &str) -> bool {
    if host == "*" {
        return true;
    }
    let candidate = host.strip_prefix("*.").unwrap_or(host);
    !candidate.is_empty()
        && host.len() <= 253
        && candidate.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn valid_path_prefix(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= MAX_PATH_BYTES
        && !path.contains("//")
        && !path
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        && !path
            .bytes()
            .any(|byte| byte <= b' ' || byte >= 0x7f || b"%?#\\*".contains(&byte))
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_incomplete_or_private_key_snapshots() {
        assert!(
            JwtEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"rules":[]}"#).is_err()
        );
        assert!(JwtEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"rules":[{"id":"admin","host":"api.example.test","path_prefix":"/","public_key_pem":"-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----"}]}"#).is_err());
    }

    #[test]
    fn rejects_malformed_bearer_values_before_signature_verification() {
        let mut validation = Validation::new(Algorithm::RS256);
        validation.leeway = 0;
        let engine = JwtEngine {
            generation: 1,
            rules: vec![JwtRule {
                host: b"api.example.test".to_vec(),
                path_prefix: b"/api".to_vec(),
                key: DecodingKey::from_rsa_components("AQ", "AQ").unwrap(),
                validation,
            }],
        };
        assert_eq!(
            engine.evaluate(b"api.example.test", b"/api/items", None),
            Ok(JwtDecision::Unauthorized)
        );
        assert_eq!(
            engine.evaluate(b"api.example.test", b"/api/items", Some(b"Basic abc")),
            Ok(JwtDecision::Unauthorized)
        );
        assert_eq!(
            engine.evaluate(b"other.example.test", b"/api/items", None),
            Ok(JwtDecision::Allow)
        );
    }
}
