//! IP Restriction Extension Module (Slot 0)
//!
//! Exposes the IP restriction engine, flat declarative policy schema,
//! materializer for Dataplane SHM Slot 0, and rule models.

pub mod engine;
pub mod ip;
pub mod materialize;
pub mod policy;
pub mod rule;

#[cfg(test)]
mod tests;

pub use engine::IpRestrictionEngine;
pub use ip::{ParsedIp, parse_client_ip, parse_ipv4_u32};
pub use materialize::materialize;
pub use policy::{
    ConfiguredRule, IpRestrictionPolicy, IpRestrictionRequest, IpRestrictionSnapshot, IpRule,
};
pub use rule::{FlatIpv4Rule, FlatIpv6Rule, HostMatcher};
