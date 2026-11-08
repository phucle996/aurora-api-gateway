//! In-process Rate Limiting Engine for Aurora Gateway (Slot 2).
//!
//! Features:
//! - Pluggable algorithms: Token Bucket, Leaky Bucket, Fixed Window, Sliding Window
//! - 64-bit Integer Fixed-Point arithmetic (Milli-tokens) with zero FPU overhead
//! - 16-way cacheline-aligned striped LRU shards with branchless SWAR 64-bit hashing
//! - Single-pass zero-allocation 429 response renderer
//! - Configurable Eviction (TTL-first, LRU, LFU, FIFO)
//! - Configurable Overflow strategy (EvictAndTrack, DropNew, BypassNew)
//! - Configurable Actions on exceeded (Throttle 429, Block 403, Audit, CustomResponse)

pub mod algorithm;
pub mod engine;
pub mod materialize;
pub mod policy;
pub mod redis;
pub mod redis_sync;
pub mod shard;

#[cfg(test)]
mod tests;

pub use engine::RateLimitEngine;
pub use materialize::materialize;
pub use policy::{
    ActionOnExceeded, EvictionPolicy, LimitBy, MAX_RATE_LIMIT_POLICY_BYTES, MAX_RATE_LIMIT_RULES,
    NUM_SHARDS, OnErrorAction, OverflowStrategy, RateLimitAlgorithm, RateLimitDecision,
    RateLimitMode, RateLimitPolicy, ResolvedHeader,
};
