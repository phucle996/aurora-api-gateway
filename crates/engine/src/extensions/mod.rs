//! Aurora Engine In-process Extensions.

pub mod access;
#[path = "blue-green/mod.rs"]
pub mod blue_green;
#[path = "canary-release/mod.rs"]
pub mod canary_release;
#[path = "connection-limit/mod.rs"]
pub mod connection_limit;
pub mod jwt;
#[path = "rate-limit/mod.rs"]
pub mod rate_limit;
#[path = "request-mirror/mod.rs"]
pub mod request_mirror;
#[path = "request-size-limit/mod.rs"]
pub mod request_size_limit;
#[path = "traffic-shaper/mod.rs"]
pub mod traffic_shaper;
#[path = "traffic-split/mod.rs"]
pub mod traffic_split;
pub mod waf;
