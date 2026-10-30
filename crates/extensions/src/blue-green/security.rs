//! Preview Security Guard & Zero-Allocation Parameter Parsing
//!
//! Defends staging/internal deployment slots against unauthorized client manipulation,
//! verifying pre-shared cryptographic secret hashes and network CIDR boundaries in registers.

use super::swar::fnv1a_64;

#[inline(always)]
fn trim_ascii(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    while start < bytes.len()
        && (bytes[start] == b' '
            || bytes[start] == b'\t'
            || bytes[start] == b'\r'
            || bytes[start] == b'\n')
    {
        start += 1;
    }
    let mut end = bytes.len();
    while end > start
        && (bytes[end - 1] == b' '
            || bytes[end - 1] == b'\t'
            || bytes[end - 1] == b'\r'
            || bytes[end - 1] == b'\n')
    {
        end -= 1;
    }
    &bytes[start..end]
}

/// Zero-allocation RFC 6265 Cookie value extractor.
#[inline]
pub fn extract_cookie_value<'a>(
    cookie_header: &'a [u8],
    target_name: &[u8],
) -> Option<&'a [u8]> {
    if target_name.is_empty() {
        return None;
    }
    let mut rest = cookie_header;
    while !rest.is_empty() {
        let (segment, next_rest) = match memchr::memchr(b';', rest) {
            Some(semi_idx) => (&rest[..semi_idx], &rest[semi_idx + 1..]),
            None => (rest, &b""[..]),
        };
        rest = next_rest;

        let trimmed = trim_ascii(segment);
        if trimmed.len() > target_name.len()
            && trimmed[target_name.len()] == b'='
            && trimmed[..target_name.len()].eq_ignore_ascii_case(target_name)
        {
            let mut val = trim_ascii(&trimmed[target_name.len() + 1..]);
            if val.len() >= 2 && val.starts_with(b"\"") && val.ends_with(b"\"") {
                val = &val[1..val.len() - 1];
            }
            return Some(val);
        }
    }
    None
}

/// Zero-allocation query parameter extractor from raw query byte slice.
#[inline]
pub fn extract_query_value<'a>(query: &'a [u8], param_name: &[u8]) -> Option<&'a [u8]> {
    if param_name.is_empty() {
        return None;
    }
    let mut rest = query;
    if rest.starts_with(b"?") {
        rest = &rest[1..];
    }
    while !rest.is_empty() {
        let (param, next_rest) = match memchr::memchr(b'&', rest) {
            Some(idx) => (&rest[..idx], &rest[idx + 1..]),
            None => (rest, &b""[..]),
        };
        rest = next_rest;

        if param.len() > param_name.len()
            && param[param_name.len()] == b'='
            && param[..param_name.len()].eq_ignore_ascii_case(param_name)
        {
            return Some(trim_ascii(&param[param_name.len() + 1..]));
        }
    }
    None
}

/// Verifies pre-shared preview secret token across Header, Cookie, and Query.
/// Returns 1 if valid or unconstrained, 0 if unauthorized.
#[inline]
pub fn verify_preview_secret<'h>(
    secret_hash: u64,
    secret_header: Option<&str>,
    query: &[u8],
    header_lookup: &impl Fn(&str) -> Option<&'h [u8]>,
) -> u8 {
    if secret_hash == 0 {
        return 1;
    }
    let sec_hdr = secret_header.unwrap_or("x-preview-secret");
    if let Some(token_bytes) = header_lookup(sec_hdr) {
        let trimmed = trim_ascii(token_bytes);
        if !trimmed.is_empty() && fnv1a_64(trimmed) == secret_hash {
            return 1;
        }
    }
    let cookie_match = header_lookup("cookie").and_then(|cookie_hdr| {
        extract_cookie_value(cookie_hdr, b"preview_secret")
            .or_else(|| extract_cookie_value(cookie_hdr, sec_hdr.as_bytes()))
            .filter(|b| !b.is_empty() && fnv1a_64(b) == secret_hash)
    });
    if cookie_match.is_some() {
        return 1;
    }
    if let Some(_token_bytes) = extract_query_value(query, b"preview_secret")
        .or_else(|| extract_query_value(query, sec_hdr.as_bytes()))
        .filter(|b| !b.is_empty() && fnv1a_64(b) == secret_hash)
    {
        return 1;
    }
    0
}

/// Verifies client IP containment within precompiled CIDR subnets. Returns 1 if allowed, 0 if forbidden.
#[inline]
pub fn verify_cidr_boundary(allowed_cidrs: &[(u32, u32)], client_ip: &[u8]) -> u8 {
    if allowed_cidrs.is_empty() {
        return 1;
    }
    if let Some(client_ip_u32) = crate::ip_restriction::parse_ipv4_u32(client_ip) {
        for &(net, mask) in allowed_cidrs {
            if (client_ip_u32 & mask) == net {
                return 1;
            }
        }
    }
    0
}
