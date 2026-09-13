//! Aurora Gateway Engine - In-process Policy Matching and Security Extensions.

pub mod extensions;
pub mod redis_pool;

pub use extensions::access;
pub use extensions::connection_limit;
pub use extensions::jwt;
pub use extensions::rate_limit;
pub use extensions::request_size_limit;
pub use extensions::traffic_shaper;
pub use extensions::traffic_split;
pub use extensions::canary_release;
pub use extensions::blue_green;
pub use extensions::request_mirror;
pub use extensions::waf;

// Top-level re-exports for clean ergonomics and backward compatibility:
pub use extensions::access::AccessEngine;
pub use extensions::connection_limit::ConnectionLimitEngine;
pub use extensions::jwt::JwtEngine;
pub use extensions::rate_limit::RateLimitEngine;
pub use extensions::request_size_limit::RequestSizeLimitEngine;
pub use extensions::traffic_shaper::TrafficShaperEngine;
pub use extensions::traffic_split::TrafficSplitEngine;
pub use extensions::canary_release::CanaryReleaseEngine;
pub use extensions::blue_green::BlueGreenEngine;
pub use extensions::request_mirror::RequestMirrorEngine;
pub use extensions::waf::{
    Action, Decision, Engine, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES, host_matches,
    host_specificity,
};
