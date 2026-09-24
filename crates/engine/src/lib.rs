//! Aurora Gateway Engine - In-process Policy Matching and Security Extensions.

pub mod decision;
pub mod extensions;
pub mod radix;
pub mod redis_pool;
pub mod shm;

pub use decision::*;
pub use radix::PathRadixTree;
pub use shm::{GatewayMetricsSnapshot, GatewaySharedMetrics};

pub use extensions::blue_green;
pub use extensions::canary_release;
pub use extensions::connection_limit;
pub use extensions::ip_restriction;
pub use extensions::jwt;
pub use extensions::rate_limit;
pub use extensions::request_mirror;
pub use extensions::request_size_limit;
pub use extensions::request_termination;
pub use extensions::traffic_shaper;
pub use extensions::traffic_split;

// Top-level re-exports for clean ergonomics:
pub use extensions::blue_green::BlueGreenEngine;
pub use extensions::canary_release::CanaryReleaseEngine;
pub use extensions::connection_limit::ConnectionLimitEngine;
pub use extensions::ip_restriction::IpRestrictionEngine;
pub use extensions::jwt::JwtEngine;
pub use extensions::rate_limit::RateLimitEngine;
pub use extensions::request_mirror::RequestMirrorEngine;
pub use extensions::request_size_limit::RequestSizeLimitEngine;
pub use extensions::request_termination::RequestTerminationEngine;
pub use extensions::traffic_shaper::TrafficShaperEngine;
pub use extensions::traffic_split::TrafficSplitEngine;
