use super::types::{KeyInput, MAX_JWT_KEYS_PER_ORIGIN};
use crate::{Error, MAX_PATH_BYTES};
use jsonwebtoken::{Algorithm, DecodingKey};
use std::collections::HashMap;

pub(crate) fn parse_algorithm(alg: &str) -> Result<Algorithm, Error> {
    match alg.to_ascii_uppercase().as_str() {
        "HS256" => Ok(Algorithm::HS256),
        "HS384" => Ok(Algorithm::HS384),
        "HS512" => Ok(Algorithm::HS512),
        "RS256" => Ok(Algorithm::RS256),
        "RS384" => Ok(Algorithm::RS384),
        "RS512" => Ok(Algorithm::RS512),
        "ES256" => Ok(Algorithm::ES256),
        "ES384" => Ok(Algorithm::ES384),
        "EDDSA" => Ok(Algorithm::EdDSA),
        _ => Err(Error::InvalidPolicy),
    }
}

pub(crate) fn compile_keys(
    alg: Algorithm,
    secret: &str,
    public_key_pem: &str,
    keys: &[KeyInput],
) -> Result<(DecodingKey, HashMap<String, DecodingKey>), Error> {
    let is_symmetric = matches!(alg, Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512);

    let mut keys_by_kid = HashMap::new();
    let mut primary_key = None;

    if !keys.is_empty() {
        if keys.len() > MAX_JWT_KEYS_PER_ORIGIN {
            return Err(Error::InvalidPolicy);
        }
        for k in keys {
            let key = if is_symmetric {
                if k.secret.is_empty() || k.secret.len() > 4096 {
                    return Err(Error::InvalidPolicy);
                }
                DecodingKey::from_secret(k.secret.as_bytes())
            } else {
                validate_and_parse_pem(alg, &k.public_key_pem)?
            };

            if k.is_primary || primary_key.is_none() {
                primary_key = Some(key.clone());
            }
            if !k.kid.is_empty() {
                keys_by_kid.insert(k.kid.clone(), key);
            }
        }
    } else if is_symmetric {
        if secret.is_empty() || secret.len() > 4096 {
            return Err(Error::InvalidPolicy);
        }
        let key = DecodingKey::from_secret(secret.as_bytes());
        primary_key = Some(key);
    } else {
        let key = validate_and_parse_pem(alg, public_key_pem)?;
        primary_key = Some(key);
    }

    let primary = primary_key.ok_or(Error::InvalidPolicy)?;
    Ok((primary, keys_by_kid))
}

pub(crate) fn validate_and_parse_pem(alg: Algorithm, pem: &str) -> Result<DecodingKey, Error> {
    if pem.is_empty() || pem.len() > 8_192 || pem.contains("PRIVATE KEY") {
        return Err(Error::InvalidPolicy);
    }
    match alg {
        Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 => {
            if !matches!(
                pem.lines().next(),
                Some("-----BEGIN PUBLIC KEY-----" | "-----BEGIN RSA PUBLIC KEY-----")
            ) {
                return Err(Error::InvalidPolicy);
            }
            DecodingKey::from_rsa_pem(pem.as_bytes()).map_err(|_| Error::InvalidPolicy)
        }
        Algorithm::ES256 | Algorithm::ES384 => {
            DecodingKey::from_ec_pem(pem.as_bytes()).map_err(|_| Error::InvalidPolicy)
        }
        Algorithm::EdDSA => {
            DecodingKey::from_ed_pem(pem.as_bytes()).map_err(|_| Error::InvalidPolicy)
        }
        _ => Err(Error::InvalidPolicy),
    }
}

pub(crate) fn valid_host(host: &str) -> bool {
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

pub(crate) fn valid_path_prefix(path: &str) -> bool {
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

pub(crate) fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}
