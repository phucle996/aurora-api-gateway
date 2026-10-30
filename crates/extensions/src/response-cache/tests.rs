//! Comprehensive unit tests for Response Cache Extension.

use aurora_engine::RequestContext;

use super::{
    evaluator::{CacheLookupResult, ResponseCacheEngine, UpstreamResponseRecord},
    policy::{ResponseCacheConfig, RouteCacheOverride},
};
use crate::response_compression::CompressionAlgorithm;

fn make_ctx<'a>(
    method: &'a [u8],
    host: &'a [u8],
    path: &'a [u8],
    query: &'a [u8],
    now_ms: u64,
) -> RequestContext<'a> {
    RequestContext {
        client_ip: b"127.0.0.1",
        host,
        path,
        method,
        query,
        content_length: 0,
        header_length: 0,
        random_seed: 42,
        now_ms,
    }
}

#[test]
fn test_cache_key_sorting_and_filtering() {
    let config = ResponseCacheConfig {
        cache_key_query_params: Some(vec!["page".to_string(), "limit".to_string()]),
        ..Default::default()
    };
    let engine = ResponseCacheEngine::new(config).unwrap();

    // Query parameters should be sorted alphabetically, and non-whitelisted tracking params ignored
    let key1 = engine.compute_cache_key(
        b"GET",
        b"api.example.com",
        b"/users",
        b"utm_source=google&limit=20&page=2&fbclid=xyz",
    );
    let key2 = engine.compute_cache_key(
        b"GET",
        b"api.example.com",
        b"/users",
        b"page=2&limit=20",
    );

    assert_eq!(key1, "GET:api.example.com:/users?limit=20&page=2");
    assert_eq!(key1, key2);
}

#[test]
fn test_cache_hit_and_miss_lifecycle() {
    let config = ResponseCacheConfig::default();
    let engine = ResponseCacheEngine::new(config).unwrap();

    let ctx_miss = make_ctx(b"GET", b"example.com", b"/items/1", b"", 1000);
    match engine.evaluate_access(&ctx_miss, None, None) {
        CacheLookupResult::Miss => {}
        _ => panic!("expected Cache Miss"),
    }

    // Store response from upstream
    let body = br#"{"id":1,"name":"Aurora Product","description":"High-performance Edge Cache"}"#;
    let record = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/items/1",
        query: b"",
        status: 200,
        content_type: "application/json",
        headers: &[("ETag".to_string(), "\"v1.0\"".to_string())],
        body,
        cache_control: Some(b"public, max-age=600"),
    };
    let stored = engine.store_response(&record);
    assert!(stored);

    // Subsequent request at t=1000 + 5 seconds should HIT
    let ctx_hit = make_ctx(b"GET", b"example.com", b"/items/1", b"", 6000);
    match engine.evaluate_access(&ctx_hit, None, None) {
        CacheLookupResult::Hit(hit) => {
            assert_eq!(hit.status, 200);
            assert_eq!(hit.content_type, "application/json");
            assert_eq!(hit.body.as_slice(), body);
            assert!(hit.headers.iter().any(|(k, v)| k == "X-Cache" && v == "HIT"));
            assert!(hit.headers.iter().any(|(k, v)| k == "Vary" && v == "Accept-Encoding"));
            assert!(hit.headers.iter().any(|(k, v)| k == "ETag" && v == "\"v1.0\""));
        }
        _ => panic!("expected Cache Hit"),
    }
}

#[test]
fn test_multi_variant_compression_negotiation() {
    let config = ResponseCacheConfig::default();
    let engine = ResponseCacheEngine::new(config).unwrap();

    let json_payload = r#"{"glossary":{"title":"example glossary","GlossDiv":{"title":"S","GlossList":{"GlossEntry":{"ID":"SGML","SortAs":"SGML","GlossTerm":"Standard Generalized Markup Language","Acronym":"SGML","Abbrev":"ISO 8879:1986","GlossDef":{"para":"A meta-markup language, used to create markup languages such as DocBook.","GlossSeeAlso":["GML","XML"]},"GlossSee":"markup"}}}}}"#;
    let body = json_payload.as_bytes();

    let record = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/glossary",
        query: b"",
        status: 200,
        content_type: "application/json",
        headers: &[],
        body,
        cache_control: Some(b"public, max-age=300"),
    };
    engine.store_response(&record);

    // 1. Client accepts Zstandard -> receives zstd variant
    let ctx_zstd = make_ctx(b"GET", b"example.com", b"/glossary", b"", 1000);
    match engine.evaluate_access(&ctx_zstd, Some(b"gzip, deflate, br, zstd"), None) {
        CacheLookupResult::Hit(hit) => {
            assert_eq!(hit.algorithm, Some(CompressionAlgorithm::Zstd));
            assert!(hit.headers.iter().any(|(k, v)| k == "Content-Encoding" && v == "zstd"));
            assert!(hit.body.len() < body.len());
        }
        _ => panic!("expected Hit with zstd"),
    }

    // 2. Client accepts Brotli -> receives br variant
    let ctx_br = make_ctx(b"GET", b"example.com", b"/glossary", b"", 1000);
    match engine.evaluate_access(&ctx_br, Some(b"gzip, deflate, br"), None) {
        CacheLookupResult::Hit(hit) => {
            assert_eq!(hit.algorithm, Some(CompressionAlgorithm::Brotli));
            assert!(hit.headers.iter().any(|(k, v)| k == "Content-Encoding" && v == "br"));
            assert!(hit.body.len() < body.len());
        }
        _ => panic!("expected Hit with br"),
    }

    // 3. Client accepts Gzip -> receives gzip variant
    let ctx_gzip = make_ctx(b"GET", b"example.com", b"/glossary", b"", 1000);
    match engine.evaluate_access(&ctx_gzip, Some(b"gzip, deflate"), None) {
        CacheLookupResult::Hit(hit) => {
            assert_eq!(hit.algorithm, Some(CompressionAlgorithm::Gzip));
            assert!(hit.headers.iter().any(|(k, v)| k == "Content-Encoding" && v == "gzip"));
            assert!(hit.body.len() < body.len());
        }
        _ => panic!("expected Hit with gzip"),
    }

    // 4. Client accepts identity -> receives raw uncompressed body
    let ctx_raw = make_ctx(b"GET", b"example.com", b"/glossary", b"", 1000);
    match engine.evaluate_access(&ctx_raw, Some(b"identity"), None) {
        CacheLookupResult::Hit(hit) => {
            assert_eq!(hit.algorithm, None);
            assert!(!hit.headers.iter().any(|(k, _)| k == "Content-Encoding"));
            assert_eq!(hit.body.as_slice(), body);
        }
        _ => panic!("expected Hit with raw body"),
    }
}

#[test]
fn test_rfc7234_cache_control_directives() {
    let config = ResponseCacheConfig::default();
    let engine = ResponseCacheEngine::new(config).unwrap();

    let body = b"Sensitive User Profile Data";

    // `no-store` must never be cached
    let record_no_store = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/profile",
        query: b"",
        status: 200,
        content_type: "text/plain",
        headers: &[],
        body,
        cache_control: Some(b"no-store, must-revalidate"),
    };
    let stored_no_store = engine.store_response(&record_no_store);
    assert!(!stored_no_store);

    // `private` must never be cached
    let record_private = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/billing",
        query: b"",
        status: 200,
        content_type: "text/plain",
        headers: &[],
        body,
        cache_control: Some(b"private, max-age=3600"),
    };
    let stored_private = engine.store_response(&record_private);
    assert!(!stored_private);

    // Client request with `Cache-Control: no-cache` must bypass cache
    let record_public = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/public-data",
        query: b"",
        status: 200,
        content_type: "text/plain",
        headers: &[],
        body,
        cache_control: Some(b"public, max-age=600"),
    };
    engine.store_response(&record_public);

    let ctx = make_ctx(b"GET", b"example.com", b"/public-data", b"", 1000);
    let bypass = engine.evaluate_access(&ctx, None, Some(b"no-cache"));
    match bypass {
        CacheLookupResult::Bypass => {}
        _ => panic!("expected bypass on Cache-Control: no-cache"),
    }
}

#[test]
fn test_lru_eviction_on_memory_threshold() {
    // 4 MB cache: 16 shards -> ~256 KB per shard
    let config = ResponseCacheConfig {
        max_memory_mb: 4,
        ..Default::default()
    };
    let engine = ResponseCacheEngine::new(config).unwrap();

    // Populate multiple large payloads to trigger eviction
    let large_payload = vec![b'A'; 64 * 1024]; // 64 KB

    for i in 0..20 {
        let path = format!("/items/{i}");
        let record = UpstreamResponseRecord {
            method: b"GET",
            host: b"example.com",
            path: path.as_bytes(),
            query: b"",
            status: 200,
            content_type: "application/octet-stream",
            headers: &[],
            body: &large_payload,
            cache_control: Some(b"public, max-age=300"),
        };
        engine.store_response(&record);
    }

    // Total memory must stay bounded within ~4MB
    let total_bytes = engine.storage.total_memory_bytes();
    assert!(total_bytes <= 4 * 1024 * 1024 + 128 * 1024);
}

#[test]
fn test_route_override_disables_cache() {
    let config = ResponseCacheConfig {
        routes_override: vec![RouteCacheOverride {
            path_prefix: "/nocache/".to_string(),
            enabled: Some(false),
            ttl_secs: None,
            cache_key_headers: None,
        }],
        ..Default::default()
    };
    let engine = ResponseCacheEngine::new(config).unwrap();

    let body = b"Payload";
    let record = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/nocache/item",
        query: b"",
        status: 200,
        content_type: "text/plain",
        headers: &[],
        body,
        cache_control: Some(b"public, max-age=300"),
    };
    engine.store_response(&record);

    let ctx = make_ctx(b"GET", b"example.com", b"/nocache/item", b"", 1000);
    match engine.evaluate_access(&ctx, None, None) {
        CacheLookupResult::Bypass => {}
        _ => panic!("expected Bypass due to route override"),
    }
}

#[test]
fn test_concurrent_lazy_compression_race_condition() {
    let config = ResponseCacheConfig::default();
    let engine = std::sync::Arc::new(ResponseCacheEngine::new(config).unwrap());

    let payload = r#"{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}],"meta":{"total":2,"page":1}}"#;
    let body = payload.as_bytes();

    let record = UpstreamResponseRecord {
        method: b"GET",
        host: b"example.com",
        path: b"/concurrent-api",
        query: b"",
        status: 200,
        content_type: "application/json",
        headers: &[],
        body,
        cache_control: Some(b"public, max-age=300"),
    };
    engine.store_response(&record);

    let initial_mem = engine.storage.total_memory_bytes();

    // Spawn 16 concurrent threads requesting the exact same variant simultaneously
    let mut handles = Vec::new();
    for _ in 0..16 {
        let eng = engine.clone();
        handles.push(std::thread::spawn(move || {
            let ctx = make_ctx(b"GET", b"example.com", b"/concurrent-api", b"", 1000);
            match eng.evaluate_access(&ctx, Some(b"gzip, deflate, br, zstd"), None) {
                CacheLookupResult::Hit(hit) => {
                    assert_eq!(hit.algorithm, Some(CompressionAlgorithm::Zstd));
                    hit.body.len()
                }
                _ => panic!("expected Cache Hit"),
            }
        }));
    }

    let mut variant_lens = Vec::new();
    for h in handles {
        variant_lens.push(h.join().unwrap());
    }

    // All threads must receive identical compressed payload size
    for len in &variant_lens {
        assert_eq!(*len, variant_lens[0]);
    }

    // Memory accounting must only increment by the variant size ONCE, no duplicate accumulation
    let final_mem = engine.storage.total_memory_bytes();
    assert_eq!(final_mem, initial_mem + variant_lens[0]);
}
