//! IP Restriction Extension Module
//!
//! Exposes the IP restriction engine, declarative configurations, and rule models.

pub mod config;
pub mod engine;
pub mod ip;
pub mod rule;

#[cfg(test)]
mod tests;

pub use config::{ConfiguredRule, IpRestrictionRequest, IpRestrictionSnapshot};
pub use engine::IpRestrictionEngine;
pub use ip::{ParsedIp, parse_client_ip, parse_ipv4_u32};
pub use rule::{FlatIpv4Rule, FlatIpv6Rule, HostMatcher};
