# Aurora Response Cache Extension

High-performance, memory-bounded, multi-variant HTTP response cache with zero-copy pointer handover and SIMD-accelerated content negotiation for Aurora API Gateway.

---

## Key Features

1. **Multi-Variant Compression Caching**: Caches uncompressed raw body alongside pre-compressed algorithm variants (`zstd`, `br`, `gzip`).
2. **Sub-Microsecond Access-Phase Fast Path**: Short-circuits upstream calls at NGINX `NGX_HTTP_ACCESS_PHASE` on Cache Hit, bypassing upstream proxying, socket allocations, and filter chains completely.
3. **Smart Lazy Content Negotiation**: Evaluates client `Accept-Encoding` header using a zero-allocation SWAR parser; serves existing pre-compressed variants directly, or lazily generates and caches missing variants on demand.
4. **RFC 7234 & RFC 9110 Compliant**: Respects upstream `Cache-Control` (`no-store`, `private`, `s-maxage`, `max-age`), client `no-cache` bypasses, and emits RFC-standard `X-Cache: HIT`, `Vary: Accept-Encoding`, and `Age` response headers.
5. **Zero-Copy Memory Pinning**: Pinned `Arc<Vec<u8>>` reference pointers handed directly to NGINX buffer chains (`ngx_buf_t`). Memory is freed cleanly via `ngx_pool_cleanup_add` when HTTP socket streaming finishes, completely eliminating use-after-free and memory copying overhead.
6. **16-Way Lock-Striped LRU Eviction**: Sub-divides cache capacity into 16 independent shards, reducing lock contention across concurrent NGINX worker threads under high-load synthetic benchmarks.

---

## Configuration Schema

```json
{
  "enabled": true,
  "default_ttl_secs": 300,
  "max_memory_mb": 256,
  "max_body_bytes": 10485760,
  "allowed_methods": ["GET", "HEAD"],
  "allowed_status_codes": [200, 203, 300, 301, 302, 307, 308, 404],
  "cache_key_query_params": ["page", "limit", "category"],
  "cache_key_headers": ["x-tenant-id"],
  "eager_compression": false,
  "routes_override": [
    {
      "path_prefix": "/api/static/",
      "enabled": true,
      "ttl_secs": 3600
    },
    {
      "path_prefix": "/api/live/",
      "enabled": false
    }
  ]
}
```

### Parameter Reference

| Parameter | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch to enable or disable in-memory response caching. |
| `default_ttl_secs` | `integer` | `300` | Default cache retention time in seconds when upstream lacks `max-age`. |
| `max_memory_mb` | `integer` | `256` | Maximum RAM capacity in megabytes allocated for the striped cache. |
| `max_body_bytes` | `integer` | `10485760` | Maximum single-response payload size eligible for caching (default 10MB). |
| `allowed_methods` | `array[string]` | `["GET", "HEAD"]` | HTTP methods permitted for cache storage and retrieval. |
| `allowed_status_codes` | `array[integer]` | `[200, 203, ...]` | Upstream HTTP response status codes permitted for caching. |
| `cache_key_query_params` | `array[string]` | `null` | Whitelist of query parameters included in the canonical cache key. |
| `cache_key_headers` | `array[string]` | `null` | Header names used to partition cache variants (e.g. multi-tenant IDs). |
| `eager_compression` | `boolean` | `false` | When true, compresses all variants (`zstd`, `br`, `gzip`) upfront upon storage. |
| `routes_override` | `array[object]` | `[]` | Granular per-prefix caching and TTL overrides. |
