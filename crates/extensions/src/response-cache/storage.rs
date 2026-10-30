//! Sharded In-Memory LRU Cache with Multi-Variant Compression Support.
//!
//! Features:
//! - 16-way lock striping to eliminate contention across NGINX worker threads.
//! - Accurate byte-level memory tracking and bounded LRU eviction.
//! - Zero-copy buffer sharing via reference-counted slices (`Arc<Vec<u8>>`).
//! - Thread-safe on-demand addition of compressed algorithm variants.

use std::{
    collections::VecDeque,
    hash::Hasher,
    sync::{
        Arc,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

use parking_lot::RwLock;
use rustc_hash::{FxHashMap, FxHasher};

use crate::response_compression::CompressionAlgorithm;

const NUM_SHARDS: usize = 16;

/// Single cached HTTP response entry.
#[derive(Debug)]
pub struct CacheEntry {
    pub key: String,
    pub status: u16,
    pub content_type: String,
    pub headers: Vec<(String, String)>,
    pub created_at_epoch_sec: u64,
    pub expires_at_epoch_sec: u64,
    pub last_accessed_epoch_sec: AtomicU64,
    pub raw_body: Arc<Vec<u8>>,
    pub variants: RwLock<FxHashMap<CompressionAlgorithm, Arc<Vec<u8>>>>,
    pub entry_size: AtomicUsize,
}

impl CacheEntry {
    /// Creates a new cache entry.
    pub fn new(
        key: String,
        status: u16,
        content_type: String,
        headers: Vec<(String, String)>,
        created_at_epoch_sec: u64,
        ttl_secs: u32,
        raw_body: Arc<Vec<u8>>,
    ) -> Self {
        let headers_size: usize = headers.iter().map(|(k, v)| k.len() + v.len()).sum();
        let initial_size = std::mem::size_of::<Self>()
            + key.len()
            + content_type.len()
            + headers_size
            + raw_body.len();

        Self {
            key,
            status,
            content_type,
            headers,
            created_at_epoch_sec,
            expires_at_epoch_sec: created_at_epoch_sec.saturating_add(u64::from(ttl_secs)),
            last_accessed_epoch_sec: AtomicU64::new(created_at_epoch_sec),
            raw_body,
            variants: RwLock::new(FxHashMap::default()),
            entry_size: AtomicUsize::new(initial_size),
        }
    }

    /// Stores a compressed variant using double-checked locking to prevent duplicate insertion race.
    /// Returns the canonical Arc and the number of newly added bytes (0 if already stored by another thread).
    pub fn store_variant(
        &self,
        algo: CompressionAlgorithm,
        variant_bytes: Arc<Vec<u8>>,
    ) -> (Arc<Vec<u8>>, usize) {
        let mut w = self.variants.write();
        if let Some(existing) = w.get(&algo) {
            return (existing.clone(), 0);
        }

        let added_bytes = variant_bytes.len();
        w.insert(algo, variant_bytes.clone());
        self.entry_size.fetch_add(added_bytes, Ordering::Relaxed);
        (variant_bytes, added_bytes)
    }

    /// Fast lookup for an existing compressed variant.
    pub fn get_variant(&self, algo: CompressionAlgorithm) -> Option<Arc<Vec<u8>>> {
        let r = self.variants.read();
        r.get(&algo).cloned()
    }

    /// Checks if entry has expired.
    #[inline]
    pub fn is_expired(&self, now_sec: u64) -> bool {
        now_sec >= self.expires_at_epoch_sec
    }
}

/// Internal state for a single shard.
struct ShardState {
    entries: FxHashMap<String, Arc<CacheEntry>>,
    lru_order: VecDeque<String>,
    current_bytes: usize,
}

impl ShardState {
    fn new() -> Self {
        Self {
            entries: FxHashMap::default(),
            lru_order: VecDeque::new(),
            current_bytes: 0,
        }
    }
}

/// Striped, memory-bounded LRU cache substrate.
pub struct ShardedLruCache {
    shards: [RwLock<ShardState>; NUM_SHARDS],
    max_memory_bytes: usize,
    max_shard_bytes: usize,
}

impl ShardedLruCache {
    /// Creates a new cache with total capacity in megabytes.
    pub fn new(max_memory_mb: usize) -> Self {
        let max_memory_bytes = max_memory_mb * 1024 * 1024;
        let max_shard_bytes = (max_memory_bytes / NUM_SHARDS).max(64 * 1024);

        Self {
            shards: std::array::from_fn(|_| RwLock::new(ShardState::new())),
            max_memory_bytes,
            max_shard_bytes,
        }
    }

    #[inline]
    fn get_shard_index(&self, key: &str) -> usize {
        let mut hasher = FxHasher::default();
        hasher.write(key.as_bytes());
        (hasher.finish() as usize) % NUM_SHARDS
    }

    /// Retrieves an entry by key if present and not expired.
    pub fn get(&self, key: &str, now_sec: u64) -> Option<Arc<CacheEntry>> {
        let idx = self.get_shard_index(key);
        let shard = &self.shards[idx];

        {
            let r = shard.read();
            let entry = r.entries.get(key)?;
            if !entry.is_expired(now_sec) {
                entry.last_accessed_epoch_sec.store(now_sec, Ordering::Relaxed);
                return Some(entry.clone());
            }
        }

        // Expired entry found: purge from shard
        let mut w = shard.write();
        if let Some(entry) = w.entries.get(key)
            && entry.is_expired(now_sec)
        {
            let bytes = entry.entry_size.load(Ordering::Relaxed);
            w.entries.remove(key);
            w.lru_order.retain(|k| k != key);
            w.current_bytes = w.current_bytes.saturating_sub(bytes);
        }
        None
    }

    /// Stores a new entry into the cache, performing LRU eviction if memory threshold exceeded.
    pub fn insert(&self, entry: CacheEntry) {
        let key = entry.key.clone();
        let entry_bytes = entry.entry_size.load(Ordering::Relaxed);
        let idx = self.get_shard_index(&key);
        let mut shard = self.shards[idx].write();

        // If replacing an existing key, adjust accounting
        if let Some(old) = shard.entries.remove(&key) {
            let old_bytes = old.entry_size.load(Ordering::Relaxed);
            shard.current_bytes = shard.current_bytes.saturating_sub(old_bytes);
            shard.lru_order.retain(|k| k != &key);
        }

        // Evict LRU entries if capacity exceeded
        while shard.current_bytes.saturating_add(entry_bytes) > self.max_shard_bytes
            && !shard.lru_order.is_empty()
        {
            if let Some(evicted_key) = shard.lru_order.pop_front()
                && let Some(evicted) = shard.entries.remove(&evicted_key)
            {
                let ev_bytes = evicted.entry_size.load(Ordering::Relaxed);
                shard.current_bytes = shard.current_bytes.saturating_sub(ev_bytes);
            }
        }

        shard.current_bytes = shard.current_bytes.saturating_add(entry_bytes);
        shard.lru_order.push_back(key.clone());
        shard.entries.insert(key, Arc::new(entry));
    }

    /// Records newly added variant bytes against the shard memory budget.
    pub fn record_variant_memory(&self, key: &str, added_bytes: usize) {
        if added_bytes == 0 {
            return;
        }
        let idx = self.get_shard_index(key);
        let mut shard = self.shards[idx].write();
        shard.current_bytes = shard.current_bytes.saturating_add(added_bytes);

        // Evict if memory threshold exceeded due to new variants
        while shard.current_bytes > self.max_shard_bytes && !shard.lru_order.is_empty() {
            if let Some(evicted_key) = shard.lru_order.pop_front() {
                if evicted_key == key {
                    // Don't evict the current entry immediately if possible
                    shard.lru_order.push_back(evicted_key);
                    break;
                }
                if let Some(evicted) = shard.entries.remove(&evicted_key) {
                    let ev_bytes = evicted.entry_size.load(Ordering::Relaxed);
                    shard.current_bytes = shard.current_bytes.saturating_sub(ev_bytes);
                }
            }
        }
    }

    /// Returns the approximate memory consumption in bytes across all shards.
    pub fn total_memory_bytes(&self) -> usize {
        self.shards.iter().map(|s| s.read().current_bytes).sum()
    }

    /// Returns the configured total memory capacity in bytes.
    pub fn max_memory_bytes(&self) -> usize {
        self.max_memory_bytes
    }

    /// Returns the total number of cached entries across all shards.
    pub fn total_entries_count(&self) -> usize {
        self.shards.iter().map(|s| s.read().entries.len()).sum()
    }

    /// Clears all entries from the cache.
    pub fn clear(&self) {
        for s in &self.shards {
            let mut w = s.write();
            w.entries.clear();
            w.lru_order.clear();
            w.current_bytes = 0;
        }
    }
}
