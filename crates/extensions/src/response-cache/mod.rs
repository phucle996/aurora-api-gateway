//! Aurora Edge HTTP Response Cache Extension.
//!
//! Features:
//! - Multi-variant compression caching: uncompressed raw body + (zstd, brotli, gzip) variants.
//! - Content negotiation at Access Phase: serves pre-compressed variants directly with 0% CPU.
//! - Lazy on-demand compression: builds compressed variants only when first requested by client.
//! - 16-way lock-striped in-memory LRU cache with accurate memory accounting.
//! - Full RFC 7234 & RFC 9110 HTTP cacheability semantics (`Cache-Control`, `Vary`, `Age`).
//! - Zero-copy pointer handover with safe reference-counted memory pinning in host pool cleanup.

pub mod evaluator;
pub mod materialize;
pub mod policy;
pub mod storage;

#[cfg(test)]
mod tests;

pub use evaluator::{CacheHitOutcome, CacheLookupResult, ResponseCacheEngine};
pub use materialize::materialize;
pub use policy::{ResponseCacheConfig, RouteCacheOverride};
pub use storage::{CacheEntry, ShardedLruCache};
