//! Resource Limit Extension Module
//!
//! Provides dual-limit admission enforcement for HTTP request header and payload sizes
//! using 1-instruction SIMD vector comparisons and branchless status code lookup.

pub mod config;
pub mod limiter;
pub mod rule;

#[cfg(test)]
mod tests;

pub use config::{
    ResourceLimitDecision, ResourceLimitRequest, ResourceLimitRuleInput, ResourceLimitSnapshot,
};
pub use limiter::ResourceLimiter;
pub use rule::{CompiledResourceRule, HostMatcher};
