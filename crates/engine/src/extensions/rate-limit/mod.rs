//! In-process Rate Limiting Engine for Aurora Gateway.
//!
//! Features:
//! - Pluggable algorithms: Token Bucket, Leaky Bucket, Fixed Window, Sliding Window
//! - Bounded memory with Sharded partition store (16 shards) to eliminate lock contention
//! - Configurable Eviction (TTL-first, LRU, LFU, FIFO)
//! - Configurable Overflow strategy (EvictAndTrack, DropNew, BypassNew)
//! - Configurable Actions on exceeded (Throttle 429, Block 403, Audit, CustomResponse)

mod algorithm;
mod engine;
mod shard;
mod types;

#[cfg(test)]
mod tests;

pub use engine::RateLimitEngine;
pub use types::{
    ActionOnExceeded, EvictionPolicy, LimitBy, MAX_RATE_LIMIT_POLICY_BYTES, MAX_RATE_LIMIT_RULES,
    NUM_SHARDS, OverflowStrategy, RateLimitAlgorithm, RateLimitDecision,
};
