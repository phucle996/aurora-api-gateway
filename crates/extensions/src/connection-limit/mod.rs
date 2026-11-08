//! Aurora Connection Limit Extension (Slot 3) - In-process and distributed concurrent connection limiter.

pub mod engine;
pub mod materialize;
pub mod policy;
pub mod redis;
pub mod redis_sync;
pub mod tracker;

#[cfg(test)]
mod tests;

pub use engine::ConnectionLimitEngine;
pub use materialize::materialize;
pub use policy::{
    ActionOnExceeded, ConnLimitDecision, ConnLimitMode, ConnLimitRule, ConnLimitToken,
    ConnectionLimitPolicy, LimitBy, OnErrorAction, RedisConfig, ResolvedHeader, TlsConfig,
};
pub use tracker::ShardedConnTracker;
