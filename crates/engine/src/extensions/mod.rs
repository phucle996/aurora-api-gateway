//! Aurora Engine In-process Extensions.

pub mod access;
#[path = "connection-limit/mod.rs"]
pub mod connection_limit;
pub mod jwt;
#[path = "rate-limit/mod.rs"]
pub mod rate_limit;
#[path = "request-size-limit/mod.rs"]
pub mod request_size_limit;
#[path = "traffic-shaper/mod.rs"]
pub mod traffic_shaper;
#[path = "traffic-split/mod.rs"]
pub mod traffic_split;
#[path = "canary-release/mod.rs"]
pub mod canary_release;
pub mod waf;
