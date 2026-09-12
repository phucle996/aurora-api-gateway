//! Aurora Gateway Engine - In-process Policy Matching and Security Extensions.

pub mod extensions;
pub mod redis_pool;

pub use extensions::access;
pub use extensions::connection_limit;
pub use extensions::jwt;
pub use extensions::rate_limit;
pub use extensions::waf;

// Top-level re-exports for clean ergonomics and backward compatibility:
pub use extensions::access::AccessEngine;
pub use extensions::connection_limit::ConnectionLimitEngine;
pub use extensions::jwt::JwtEngine;
pub use extensions::rate_limit::RateLimitEngine;
pub use extensions::waf::{
    Action, Decision, Engine, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES, host_matches,
    host_specificity,
};
