use super::types::NUM_SHARDS;
use std::collections::HashMap;
use std::sync::Mutex;

#[repr(align(64))]
struct CacheAligned<T>(pub T);

type ConnShard = CacheAligned<Mutex<HashMap<Vec<u8>, u32>>>;

pub(crate) struct ShardedConnTracker {
    shards: Vec<ConnShard>,
}

impl ShardedConnTracker {
    pub fn new() -> Self {
        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(CacheAligned(Mutex::new(HashMap::new())));
        }
        Self { shards }
    }

    #[inline(always)]
    fn hash_key(key: &[u8]) -> usize {
        let mut hash: u64 = 0xcbf29ce484222325;
        let mut i = 0;
        while i + 4 <= key.len() {
            hash = (hash ^ key[i] as u64).wrapping_mul(0x100000001b3);
            hash = (hash ^ key[i + 1] as u64).wrapping_mul(0x100000001b3);
            hash = (hash ^ key[i + 2] as u64).wrapping_mul(0x100000001b3);
            hash = (hash ^ key[i + 3] as u64).wrapping_mul(0x100000001b3);
            i += 4;
        }
        while i < key.len() {
            hash = (hash ^ key[i] as u64).wrapping_mul(0x100000001b3);
            i += 1;
        }
        (hash as usize) & (NUM_SHARDS - 1)
    }

    #[inline]
    pub fn acquire(&self, key: &[u8], max_connections: u32) -> (bool, u32) {
        let shard_idx = Self::hash_key(key);
        let mut map = match self.shards[shard_idx].0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if let Some(count) = map.get_mut(key) {
            if *count >= max_connections {
                return (false, *count);
            }
            *count += 1;
            (true, *count)
        } else {
            map.insert(key.to_vec(), 1);
            (true, 1)
        }
    }

    #[inline]
    pub fn release(&self, key: &[u8]) {
        let shard_idx = Self::hash_key(key);
        let mut map = match self.shards[shard_idx].0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if let Some(count) = map.get_mut(key) {
            if *count > 1 {
                *count -= 1;
            } else {
                map.remove(key);
            }
        }
    }
}
