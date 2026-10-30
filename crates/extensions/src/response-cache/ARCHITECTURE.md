# Response Cache Architecture

## 1. End-to-End Workflow

```
[ Client Request ]
       │
       ▼
[ NGINX: ngx_http_gateway_access_handler ]
       │
       ▼
[ Rust C-ABI: aurora_gateway_phase_access ]
       │
       ├─► Admission / Security / Limiting (IP, JWT, Rate Limit)
       │     └─► If Denied: Return Error (401, 403, 429) immediately.
       │
       ▼
[ ResponseCacheEngine::evaluate_access ]
       │
       ├─► Cache Miss / Bypass:
       │     Return ALLOW ──► Forward to Upstream Backend (proxy_pass)
       │                           │
       │                           ▼
       │                    [ Upstream Response ]
       │                           │
       │                           ▼
       │                    [ NGINX Header & Body Filter ]
       │                           │
       │                           ▼
       │                    [ aurora_gateway_phase_cache_store ]
       │                    Stores uncompressed body + variant in LRU Cache
       │
       └─► Cache Hit:
             ├─► SWAR Content Negotiation against Accept-Encoding
             ├─► Retrieve or Lazily Compress Variant (zstd / br / gzip / raw)
             ├─► Pin `Arc<Vec<u8>>` via `Arc::into_raw`
             └─► Return Direct Response to NGINX:
                   • Status: 200 / 304
                   • Content-Type: upstream content type
                   • Body: pointer directly to pinned cache buffer
                   • Headers: X-Cache: HIT, Content-Encoding, Vary, Age
                   • Release Token: pointer to pinned Arc
                   │
                   ▼
             [ NGINX: ngx_http_gateway_execute_deny ]
                   ├─► Register `ngx_pool_cleanup_add` with `aurora_release_cache_entry`
                   ├─► Append response headers to `r->headers_out.headers`
                   ├─► Stream buffer directly via `ngx_http_output_filter`
                   └─► Return NGX_DONE (Upstream bypassed!)
```

---

## 2. Zero-Copy Pointer Handover & Safe Memory Lifecycle

When an NGINX worker serves a cached response:
1. Rust creates an uncompressed or compressed buffer inside an `Arc<Vec<u8>>`.
2. Rust bumps the reference count and converts the Arc into a raw pointer:
   ```rust
   let raw_ptr = Arc::into_raw(variant.clone());
   ```
3. NGINX assigns the buffer pointer directly to `ngx_buf_t`:
   ```c
   b->pos = (u_char *)out->body;
   b->last = (u_char *)out->body + out->body_len;
   b->memory = 1;
   ```
4. NGINX registers a request pool cleanup handler:
   ```c
   ngx_pool_cleanup_t *cln = ngx_pool_cleanup_add(r->pool, 0);
   cln->handler = (ngx_pool_cleanup_pt)aurora_release_cache_entry;
   cln->data = (void *)raw_ptr;
   ```
5. When NGINX finishes streaming the response socket (or if the client disconnects prematurely), `r->pool` is destroyed, invoking `aurora_release_cache_entry(cln->data)`:
   ```rust
   #[unsafe(no_mangle)]
   pub unsafe extern "C" fn aurora_release_cache_entry(data: *mut c_void) {
       if !data.is_null() {
           unsafe { drop(Arc::from_raw(data as *const Vec<u8>)); }
       }
   }
   ```
   This decrements the Arc reference counter. Even if the cache entry was evicted by LRU while streaming was in progress, the underlying buffer memory remains valid until NGINX finishes writing to the network!

---

## 3. Sharded LRU Eviction

- Cache capacity is partitioned across 16 independent `RwLock<ShardState>` shards using `rustc_hash::FxHasher`.
- Read operations (Cache Hits) acquire a read lock on the targeted shard, verify TTL, and update the variant on demand.
- Write operations (Insertions / Evictions) acquire a write lock only on the targeted shard, leaving the other 15 shards completely non-blocking.
- Eviction is based on double-ended `VecDeque` tracking the oldest unaccessed keys, maintaining memory strictly within `max_memory_mb`.
