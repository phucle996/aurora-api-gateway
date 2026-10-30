//! Preview Security Guard & Zero-Allocation Parameter Parsing
//!
//! Defends staging/internal deployment slots against unauthorized client manipulation,
//! verifying pre-shared cryptographic secret hashes and network CIDR boundaries in registers.

use super::swar::fnv1a_64;

/// Zero-allocation RFC 6265 Cookie value extractor.
#[inline]
pub fn extract_cookie_value<'a>(
    cookie_header: &'a [u8],
    target_name: &[u8],
) -> Option<&'a [u8]> {
    let mut rest = cookie_header;
    while !rest.is_empty() {
        let (segment, next_rest) = match memchr::memchr(b';', rest) {
            Some(semi_idx) => (&rest[..semi_idx], &rest[semi_idx + 1..]),
            None => (rest, &b""[..]),
        };
        rest = next_rest;

        let mut start = 0;
        while start < segment.len() && (segment[start] == b' ' || segment[start] == b'\t') {
            start += 1;
        }
        let trimmed = &segment[start..];

        if let Some(after) = trimmed.strip_prefix(target_name)
            && after.starts_with(b"=")
        {
            let mut val = &after[1..];
            while let Some((&last, rem)) = val.split_last() {
                if last == b' ' || last == b'\t' {
                    val = rem;
                } else {
                    break;
                }
            }
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

        if let Some(val) = param.strip_prefix(param_name) {
            if val.starts_with(b"=") {
                return Some(&val[1..]);
            }
        }
    }
    None
}

/// Verifies pre-shared preview secret token. Returns 1 if valid or unconstrained, 0 if unauthorized.
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
        let token_hash = fnv1a_64(token_bytes);
        return (token_hash == secret_hash) as u8;
    }
    if let Some(token_bytes) = extract_query_value(query, b"preview_secret") {
        let token_hash = fnv1a_64(token_bytes);
        return (token_hash == secret_hash) as u8;
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
