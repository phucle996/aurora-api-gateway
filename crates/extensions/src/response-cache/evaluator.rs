//! Response Cache Evaluation and Variant Negotiation Engine.
//!
//! Handles:
//! - RFC 7234 & RFC 9110 HTTP Cacheability rules.
//! - Canonical Cache-Key construction with sorted query parameters.
//! - Multi-variant content negotiation (zstd > brotli > gzip > identity).
//! - Lazy on-demand compression for missing variants with host thread safety.
//! - Upstream cache population during response filter phases.

use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use aurora_engine::{PathRadixTree, RequestContext};

use crate::response_compression::{
    CLIENT_ENCODING_BR, CLIENT_ENCODING_GZIP, CLIENT_ENCODING_ZSTD, CompressionAlgorithm,
    compress_into, parse_accept_encoding_mask,
};

use super::{
    policy::{ResponseCacheConfig, RouteCacheOverride},
    storage::{CacheEntry, ShardedLruCache},
};

/// Upstream response payload and metadata evaluated for cache storage.
#[derive(Debug)]
pub struct UpstreamResponseRecord<'a> {
    pub method: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub query: &'a [u8],
    pub status: u16,
    pub content_type: &'a str,
    pub headers: &'a [(String, String)],
    pub body: &'a [u8],
    pub cache_control: Option<&'a [u8]>,
}

/// Cache lookup outcome for Phase 1: HTTP Access.
pub enum CacheLookupResult {
    /// Cache Hit with pre-compressed or uncompressed body and headers.
    Hit(CacheHitOutcome),
    /// Cache Miss (request must be forwarded to upstream).
    Miss,
    /// Cache Bypass (method, route, or request headers require skipping cache).
    Bypass,
}

/// Consolidated payload for a Cache Hit.
#[derive(Debug, Clone)]
pub struct CacheHitOutcome {
    pub status: u16,
    pub content_type: String,
    pub body: Arc<Vec<u8>>,
    pub headers: Vec<(String, String)>,
    pub algorithm: Option<CompressionAlgorithm>,
}

/// Core evaluation engine for HTTP caching and variant negotiation.
pub struct ResponseCacheEngine {
    pub config: Arc<ResponseCacheConfig>,
    pub storage: Arc<ShardedLruCache>,
    route_trie: PathRadixTree<RouteCacheOverride>,
}

impl ResponseCacheEngine {
    /// Creates a new engine instance.
    pub fn new(config: ResponseCacheConfig) -> Result<Self, String> {
        let config = config.sanitize();
        let storage = Arc::new(ShardedLruCache::new(config.max_memory_mb));

        let mut trie = PathRadixTree::new();
        for r in &config.routes_override {
            trie.insert(r.path_prefix.as_bytes(), r.clone());
        }

        Ok(Self {
            config: Arc::new(config),
            storage,
            route_trie: trie,
        })
    }

    /// Evaluates incoming HTTP request at Access Phase.
    pub fn evaluate_access(
        &self,
        ctx: &RequestContext<'_>,
        accept_encoding: Option<&[u8]>,
        cache_control: Option<&[u8]>,
    ) -> CacheLookupResult {
        if !self.config.enabled {
            return CacheLookupResult::Bypass;
        }

        // Method check
        if !self.config.is_method_cacheable(ctx.method) {
            return CacheLookupResult::Bypass;
        }

        // Check per-route override
        let mut route_enabled = None;
        self.route_trie.for_each_match(ctx.path, |override_cfg| {
            if let Some(en) = override_cfg.enabled {
                route_enabled = Some(en);
            }
        });

        if let Some(false) = route_enabled {
            return CacheLookupResult::Bypass;
        }

        // Check request Cache-Control for client bypass (no-cache, no-store)
        if let Some(cc) = cache_control
            && (has_directive(cc, b"no-cache") || has_directive(cc, b"no-store"))
        {
            return CacheLookupResult::Bypass;
        }

        let now_sec = if ctx.now_ms > 0 {
            ctx.now_ms / 1000
        } else {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        };

        // Construct Canonical Cache Key
        let cache_key = self.compute_cache_key(ctx.method, ctx.host, ctx.path, ctx.query);

        // Lookup in LRU cache
        let entry = match self.storage.get(&cache_key, now_sec) {
            Some(e) => e,
            None => return CacheLookupResult::Miss,
        };

        // Content Negotiation with multi-variant compression
        let (body, algo, content_encoding) = self.negotiate_variant(&entry, accept_encoding);

        let age = now_sec.saturating_sub(entry.created_at_epoch_sec);
        let mut headers = Vec::with_capacity(entry.headers.len() + 4);

        // Inherit cached upstream response headers
        for (k, v) in &entry.headers {
            headers.push((k.clone(), v.clone()));
        }

        headers.push(("X-Cache".to_string(), "HIT".to_string()));
        headers.push(("Vary".to_string(), "Accept-Encoding".to_string()));
        headers.push(("Age".to_string(), age.to_string()));

        if let Some(ce) = content_encoding {
            headers.push(("Content-Encoding".to_string(), ce.to_string()));
        }

        CacheLookupResult::Hit(CacheHitOutcome {
            status: entry.status,
            content_type: entry.content_type.clone(),
            body,
            headers,
            algorithm: algo,
        })
    }

    /// Negotiates the best compression variant for client's Accept-Encoding.
    /// Lazily compresses on demand if the requested variant is not yet generated.
    fn negotiate_variant(
        &self,
        entry: &CacheEntry,
        accept_encoding: Option<&[u8]>,
    ) -> (Arc<Vec<u8>>, Option<CompressionAlgorithm>, Option<&'static str>) {
        let mask = accept_encoding
            .and_then(|ae| std::str::from_utf8(ae).ok())
            .map(parse_accept_encoding_mask)
            .unwrap_or(0);

        // Preference order: Zstd > Brotli > Gzip > Identity
        if mask & CLIENT_ENCODING_ZSTD != 0 {
            if let Some(var) = entry.get_variant(CompressionAlgorithm::Zstd) {
                return (var, Some(CompressionAlgorithm::Zstd), Some("zstd"));
            }
            if let Some(var) = self.lazy_compress(entry, CompressionAlgorithm::Zstd) {
                return (var, Some(CompressionAlgorithm::Zstd), Some("zstd"));
            }
        }

        if mask & CLIENT_ENCODING_BR != 0 {
            if let Some(var) = entry.get_variant(CompressionAlgorithm::Brotli) {
                return (var, Some(CompressionAlgorithm::Brotli), Some("br"));
            }
            if let Some(var) = self.lazy_compress(entry, CompressionAlgorithm::Brotli) {
                return (var, Some(CompressionAlgorithm::Brotli), Some("br"));
            }
        }

        if mask & CLIENT_ENCODING_GZIP != 0 {
            if let Some(var) = entry.get_variant(CompressionAlgorithm::Gzip) {
                return (var, Some(CompressionAlgorithm::Gzip), Some("gzip"));
            }
            if let Some(var) = self.lazy_compress(entry, CompressionAlgorithm::Gzip) {
                return (var, Some(CompressionAlgorithm::Gzip), Some("gzip"));
            }
        }

        // Identity / Uncompressed fallback
        (entry.raw_body.clone(), None, None)
    }

    /// Compresses uncompressed raw_body on demand and caches the result.
    fn lazy_compress(
        &self,
        entry: &CacheEntry,
        algo: CompressionAlgorithm,
    ) -> Option<Arc<Vec<u8>>> {
        // Fast-path: another thread might have just completed compression
        if let Some(existing) = entry.get_variant(algo) {
            return Some(existing);
        }

        let level = match algo {
            CompressionAlgorithm::Zstd => 3,
            CompressionAlgorithm::Brotli => 4,
            CompressionAlgorithm::Gzip => 6,
            CompressionAlgorithm::None => 0,
        };

        let max_size = entry.raw_body.len().saturating_add(128);
        let mut out = vec![0u8; max_size];
        if let Ok(written) = compress_into(algo, level, &entry.raw_body, &mut out)
            && written > 0
            && written < entry.raw_body.len()
        {
            out.truncate(written);
            let arc = Arc::new(out);
            let (canonical_arc, added_bytes) = entry.store_variant(algo, arc);
            if added_bytes > 0 {
                self.storage.record_variant_memory(&entry.key, added_bytes);
            }
            return Some(canonical_arc);
        }
        None
    }

    /// Stores an upstream HTTP response into cache if eligible under RFC 7234 rules.
    pub fn store_response(&self, record: &UpstreamResponseRecord<'_>) -> bool {
        if !self.config.enabled {
            return false;
        }

        if !self.config.is_method_cacheable(record.method)
            || !self.config.is_status_cacheable(record.status)
        {
            return false;
        }

        if record.body.is_empty() || record.body.len() > self.config.max_body_bytes {
            return false;
        }

        // RFC 7234 cacheability checks
        let mut ttl_secs = self.config.default_ttl_secs;
        if let Some(cc) = record.cache_control {
            if has_directive(cc, b"no-store") || has_directive(cc, b"private") {
                return false;
            }
            if let Some(s_max) = parse_directive_seconds(cc, b"s-maxage") {
                ttl_secs = s_max;
            } else if let Some(max_age) = parse_directive_seconds(cc, b"max-age") {
                ttl_secs = max_age;
            }
        }

        // Apply route-specific TTL override if present
        self.route_trie.for_each_match(record.path, |override_cfg| {
            if let Some(t) = override_cfg.ttl_secs {
                ttl_secs = t;
            }
        });

        if ttl_secs == 0 {
            return false;
        }

        let now_sec = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let key = self.compute_cache_key(record.method, record.host, record.path, record.query);
        let raw_body = Arc::new(record.body.to_vec());

        // Sanitize headers to cache (omit hop-by-hop headers and transfer encodings)
        let mut cached_headers = Vec::new();
        for (k, v) in record.headers {
            let k_low = k.to_ascii_lowercase();
            if k_low != "connection"
                && k_low != "transfer-encoding"
                && k_low != "content-length"
                && k_low != "content-encoding"
                && k_low != "age"
            {
                cached_headers.push((k.clone(), v.clone()));
            }
        }

        let entry = CacheEntry::new(
            key,
            record.status,
            record.content_type.to_string(),
            cached_headers,
            now_sec,
            ttl_secs,
            raw_body,
        );

        // Pre-compress eager variants if configured
        if self.config.eager_compression {
            let algos = [
                (CompressionAlgorithm::Zstd, 3),
                (CompressionAlgorithm::Brotli, 4),
                (CompressionAlgorithm::Gzip, 6),
            ];
            for (algo, level) in algos {
                let max_size = record.body.len().saturating_add(128);
                let mut out = vec![0u8; max_size];
                if let Ok(written) = compress_into(algo, level, record.body, &mut out)
                    && written > 0
                    && written < record.body.len()
                {
                    out.truncate(written);
                    entry.store_variant(algo, Arc::new(out));
                }
            }
        }

        self.storage.insert(entry);
        true
    }

    /// Computes canonical cache key with sorted, normalized query parameters.
    pub fn compute_cache_key(
        &self,
        method: &[u8],
        host: &[u8],
        path: &[u8],
        query: &[u8],
    ) -> String {
        let m_str = std::str::from_utf8(method).unwrap_or("GET");
        let h_str = std::str::from_utf8(host).unwrap_or("localhost");
        let p_str = std::str::from_utf8(path).unwrap_or("/");

        let mut key =
            String::with_capacity(m_str.len() + h_str.len() + p_str.len() + query.len() + 4);
        key.push_str(m_str);
        key.push(':');
        for &b in host {
            key.push(b.to_ascii_lowercase() as char);
        }
        key.push(':');
        key.push_str(p_str);

        if !query.is_empty()
            && let Ok(q_str) = std::str::from_utf8(query)
        {
            let mut pairs: Vec<(&str, &str)> = q_str
                .split('&')
                .filter_map(|pair| {
                    if pair.is_empty() {
                        return None;
                    }
                    let mut parts = pair.splitn(2, '=');
                    let k = parts.next()?;
                    let v = parts.next().unwrap_or("");
                    if let Some(ref allowed) = self.config.cache_key_query_params
                        && !allowed.iter().any(|a| a == k)
                    {
                        return None;
                    }
                    Some((k, v))
                })
                .collect();

            if !pairs.is_empty() {
                pairs.sort_unstable_by(|a, b| a.0.cmp(b.0).then_with(|| a.1.cmp(b.1)));
                key.push('?');
                for (i, (k, v)) in pairs.into_iter().enumerate() {
                    if i > 0 {
                        key.push('&');
                    }
                    key.push_str(k);
                    if !v.is_empty() {
                        key.push('=');
                        key.push_str(v);
                    }
                }
            }
        }

        key
    }
}

/// Helper: checks if a Cache-Control directive exists (e.g. "no-cache", "no-store", "private").
fn has_directive(cc: &[u8], directive: &[u8]) -> bool {
    let d_len = directive.len();
    if cc.len() < d_len {
        return false;
    }

    for (i, window) in cc.windows(d_len).enumerate() {
        if window.eq_ignore_ascii_case(directive) {
            let left_ok = i == 0 || cc[i - 1] == b',' || cc[i - 1] == b' ';
            let right_idx = i + d_len;
            let right_ok = right_idx == cc.len()
                || cc[right_idx] == b','
                || cc[right_idx] == b' '
                || cc[right_idx] == b'='
                || cc[right_idx] == b';';
            if left_ok && right_ok {
                return true;
            }
        }
    }
    false
}

/// Helper: parses seconds from directive like `max-age=3600` or `s-maxage=60`.
fn parse_directive_seconds(cc: &[u8], directive_prefix: &[u8]) -> Option<u32> {
    let p_len = directive_prefix.len();
    let mut i = 0;
    while i + p_len < cc.len() {
        if cc[i..i + p_len].eq_ignore_ascii_case(directive_prefix) {
            let mut j = i + p_len;
            while j < cc.len() && (cc[j] == b' ' || cc[j] == b'=') {
                j += 1;
            }
            let start = j;
            while j < cc.len() && cc[j].is_ascii_digit() {
                j += 1;
            }
            if start < j
                && let Ok(s) = std::str::from_utf8(&cc[start..j])
                && let Ok(sec) = s.parse::<u32>()
            {
                return Some(sec);
            }
        }
        i += 1;
    }
    None
}
