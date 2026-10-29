//! IP Parsing and Bitwise Arithmetic Operations
//!
//! Provides zero-allocation, high-throughput parsing of IPv4 and IPv6 addresses
//! directly into `u32` and `u128` primitives, along with bitwise subnet mask math.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParsedIp {
    V4(u32),
    V6(u128),
}

/// Parses an ASCII byte slice into a 32-bit big-endian integer representing IPv4.
/// Returns `None` if the input is not a valid dotted-decimal IPv4 address.
#[inline(always)]
pub fn parse_ipv4_u32(bytes: &[u8]) -> Option<u32> {
    if bytes.len() < 7 || bytes.len() > 15 {
        return None;
    }
    let mut octets = [0u8; 4];
    let mut octet_idx = 0;
    let mut val = 0u32;
    let mut digits = 0;

    for &b in bytes {
        if b == b'.' {
            if digits == 0 || digits > 3 || val > 255 || octet_idx >= 3 {
                return None;
            }
            octets[octet_idx] = val as u8;
            octet_idx += 1;
            val = 0;
            digits = 0;
        } else if b.is_ascii_digit() {
            val = val * 10 + (b - b'0') as u32;
            digits += 1;
        } else {
            return None;
        }
    }

    if digits == 0 || digits > 3 || val > 255 || octet_idx != 3 {
        return None;
    }
    octets[3] = val as u8;
    Some(u32::from_be_bytes(octets))
}

/// Parses an incoming client IP byte slice into `ParsedIp` (IPv4 `u32` or IPv6 `u128`).
/// Automatically unmaps IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`) to native IPv4 `u32`.
#[inline(always)]
pub fn parse_client_ip(bytes: &[u8]) -> Option<ParsedIp> {
    // 1. Fast-path: IPv4 dotted-decimal (covers 95%+ of typical traffic)
    if let Some(v4) = parse_ipv4_u32(bytes) {
        return Some(ParsedIp::V4(v4));
    }

    // 2. IPv6 / IPv4-mapped IPv6 parsing
    let s = std::str::from_utf8(bytes).ok()?;
    match IpAddr::from_str(s).ok()? {
        IpAddr::V4(v4) => Some(ParsedIp::V4(u32::from(v4))),
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                Some(ParsedIp::V4(u32::from(mapped_v4)))
            } else {
                Some(ParsedIp::V6(u128::from(v6)))
            }
        }
    }
}

/// Converts an IPv4 CIDR prefix length (0..=32) into a 32-bit subnet mask.
#[inline(always)]
pub const fn prefix_to_ipv4_mask(prefix: u8) -> u32 {
    if prefix == 0 {
        0
    } else if prefix >= 32 {
        u32::MAX
    } else {
        !((1u32 << (32 - prefix)) - 1)
    }
}

/// Converts an IPv6 CIDR prefix length (0..=128) into a 128-bit subnet mask.
#[inline(always)]
pub const fn prefix_to_ipv6_mask(prefix: u8) -> u128 {
    if prefix == 0 {
        0
    } else if prefix >= 128 {
        u128::MAX
    } else {
        !((1u128 << (128 - prefix)) - 1)
    }
}

/// Parses an IPv4 CIDR string (e.g., "192.168.1.0/24") into `(network, mask, prefix)`.
pub fn parse_ipv4_cidr(s: &str) -> Option<(u32, u32, u8)> {
    let (ip_str, prefix_str) = match s.split_once('/') {
        Some((ip, p)) => (ip, p),
        None => (s, "32"),
    };

    let ip = Ipv4Addr::from_str(ip_str.trim()).ok()?;
    let prefix = prefix_str.trim().parse::<u8>().ok()?;
    if prefix > 32 {
        return None;
    }

    let raw_ip = u32::from(ip);
    let mask = prefix_to_ipv4_mask(prefix);
    Some((raw_ip & mask, mask, prefix))
}

/// Parses an IPv6 CIDR string (e.g., "2001:db8::/32") into `(network, mask, prefix)`.
/// Strictly rejects IPv4-mapped IPv6 in snapshot rules (`::ffff:x.x.x.x`).
pub fn parse_ipv6_cidr(s: &str) -> Option<(u128, u128, u8)> {
    let (ip_str, prefix_str) = match s.split_once('/') {
        Some((ip, p)) => (ip, p),
        None => (s, "128"),
    };

    let ip = Ipv6Addr::from_str(ip_str.trim()).ok()?;
    if ip.to_ipv4_mapped().is_some() {
        return None;
    }

    let prefix = prefix_str.trim().parse::<u8>().ok()?;
    if prefix > 128 {
        return None;
    }

    let raw_ip = u128::from(ip);
    let mask = prefix_to_ipv6_mask(prefix);
    Some((raw_ip & mask, mask, prefix))
}
