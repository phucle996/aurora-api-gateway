use super::types::NUM_SHARDS;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

pub(crate) struct ShardedConnTracker {
    shards: Vec<Mutex<HashMap<Vec<u8>, Arc<AtomicU32>>>>,
}

impl ShardedConnTracker {
    pub fn new() -> Self {
        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(Mutex::new(HashMap::new()));
        }
        Self { shards }
    }

    fn hash_key(key: &[u8]) -> usize {
        let mut hash: u64 = 0xcbf29ce484222325;
        for &byte in key {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash as usize
    }

    pub fn acquire(&self, key: &[u8], max_connections: u32) -> (bool, u32) {
        let shard_idx = Self::hash_key(key) % NUM_SHARDS;
        let counter = {
            let mut map = match self.shards[shard_idx].lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.entry(key.to_vec())
                .or_insert_with(|| Arc::new(AtomicU32::new(0)))
                .clone()
        };

        let mut current = counter.load(Ordering::Relaxed);
        loop {
            if current >= max_connections {
                return (false, current);
            }
            match counter.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return (true, current + 1),
                Err(actual) => current = actual,
            }
        }
    }

    pub fn release(&self, key: &[u8]) {
        let shard_idx = Self::hash_key(key) % NUM_SHARDS;
        let counter_opt = {
            let map = match self.shards[shard_idx].lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.get(key).cloned()
        };

        if let Some(counter) = counter_opt {
            let mut current = counter.load(Ordering::Relaxed);
            loop {
                if current == 0 {
                    break;
                }
                match counter.compare_exchange_weak(
                    current,
                    current - 1,
                    Ordering::AcqRel,
                    Ordering::Relaxed,
                ) {
                    Ok(new_val) => {
                        // If counter reached 0 and map has grown large, try to prune
                        if new_val == 1
                            && let Ok(mut map) = self.shards[shard_idx].try_lock()
                            && map.len() > 1000
                        {
                            map.retain(|_, v| v.load(Ordering::Relaxed) > 0);
                        }
                        break;
                    }
                    Err(actual) => current = actual,
                }
            }
        }
    }
}
