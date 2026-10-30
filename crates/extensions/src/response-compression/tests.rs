//! Exhaustive test suite for Response Compression extension.

use super::compressor::CompressionAlgorithm;
use super::evaluator::{
    parse_accept_encoding_mask, HeaderDecisionAction, ResponseCompressionEngine,
    CLIENT_ENCODING_BR, CLIENT_ENCODING_GZIP, CLIENT_ENCODING_ZSTD,
};
use super::policy::{ResponseCompressionConfig, RouteCompressionOverride};
use std::ffi::c_void;

#[test]
fn test_accept_encoding_mask_parsing() {
    assert_eq!(
        parse_accept_encoding_mask("gzip, deflate, br, zstd"),
        CLIENT_ENCODING_GZIP | CLIENT_ENCODING_BR | CLIENT_ENCODING_ZSTD
    );

    assert_eq!(parse_accept_encoding_mask("gzip"), CLIENT_ENCODING_GZIP);
    assert_eq!(parse_accept_encoding_mask("br"), CLIENT_ENCODING_BR);
    assert_eq!(parse_accept_encoding_mask("zstd"), CLIENT_ENCODING_ZSTD);

    // Q-value = 0 rejections
    assert_eq!(
        parse_accept_encoding_mask("gzip;q=0, br;q=1.0"),
        CLIENT_ENCODING_BR
    );
    assert_eq!(
        parse_accept_encoding_mask("zstd;q=0.0, gzip;q=0.5"),
        CLIENT_ENCODING_GZIP
    );

    // Empty or unsupported
    assert_eq!(parse_accept_encoding_mask("deflate, compress, identity"), 0);
    assert_eq!(parse_accept_encoding_mask(""), 0);
}

#[test]
fn test_header_evaluation_and_algorithm_negotiation() {
    let config = ResponseCompressionConfig {
        enabled: true,
        min_length: 512,
        prefer_algorithms: vec!["zstd".into(), "br".into(), "gzip".into()],
        ..Default::default()
    };
    let engine = ResponseCompressionEngine::new(config).unwrap();

    // 1. Client supports zstd, br, gzip -> should choose zstd (highest priority)
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "application/json; charset=utf-8",
        2048,
        "gzip, deflate, br, zstd",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Zstd);
    assert_eq!(dec.content_encoding, "zstd");

    // 2. Client supports only br and gzip -> should choose br
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "application/json",
        2048,
        "gzip, br",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Brotli);
    assert_eq!(dec.content_encoding, "br");

    // 3. Client supports only gzip -> should choose gzip
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "application/json",
        2048,
        "gzip",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Gzip);
    assert_eq!(dec.content_encoding, "gzip");

    // 4. Client doesn't support compression -> Passthrough
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "application/json",
        2048,
        "identity",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 5. Status code 204 No Content -> Passthrough
    let dec = engine.evaluate_header(
        "/api/v1/users",
        204,
        "application/json",
        0,
        "gzip, zstd",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 6. Content length below min_length -> Passthrough
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "application/json",
        256,
        "gzip, zstd",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 7. Non-compressible MIME type -> Passthrough
    let dec = engine.evaluate_header(
        "/api/v1/image.png",
        200,
        "image/png",
        8192,
        "gzip, zstd",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);
}

#[test]
fn test_per_route_overrides() {
    let config = ResponseCompressionConfig {
        enabled: true,
        min_length: 512,
        prefer_algorithms: vec!["zstd".into(), "gzip".into()],
        routes_override: vec![
            // Disable on sensitive auth route
            RouteCompressionOverride {
                path_prefix: "/api/v1/auth".into(),
                enabled: Some(false),
                min_length: None,
                prefer_algorithms: None,
            },
            // Force Brotli on static assets
            RouteCompressionOverride {
                path_prefix: "/static/".into(),
                enabled: Some(true),
                min_length: Some(100),
                prefer_algorithms: Some(vec!["br".into()]),
            },
        ],
        ..Default::default()
    };
    let engine = ResponseCompressionEngine::new(config).unwrap();

    // Auth endpoint must pass through uncompressed
    let dec = engine.evaluate_header(
        "/api/v1/auth/token",
        200,
        "application/json",
        1024,
        "zstd, br, gzip",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // Static assets prefer br
    let dec = engine.evaluate_header(
        "/static/app.css",
        200,
        "text/css",
        256,
        "zstd, br, gzip",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Brotli);
    assert_eq!(dec.content_encoding, "br");
}

// Mock C-ABI allocator representing `ngx_pnalloc(r->pool, size)`
unsafe extern "C" fn mock_host_alloc(ctx: *mut c_void, size: usize) -> *mut u8 {
    let arena = unsafe { &mut *(ctx as *mut Vec<Vec<u8>>) };
    let mut block = vec![0u8; size];
    let ptr = block.as_mut_ptr();
    arena.push(block);
    ptr
}

#[test]
fn test_zero_copy_single_shot_compression_handover() {
    let config = ResponseCompressionConfig::default();
    let engine = ResponseCompressionEngine::new(config).unwrap();

    let sample_json = br#"{"event":"purchase","item_id":9921,"price":149.99,"customer":"Alice","description":"High performance enterprise gateway response with simulated realistic payload length for compression ratio testing","details":{"items":[{"id":1,"name":"Item A","qty":10},{"id":2,"name":"Item B","qty":5}],"meta":{"processed_by":"aurora","cluster":"east-1"}}}"#;
    let mut arena: Vec<Vec<u8>> = Vec::new();
    let ctx = &mut arena as *mut _ as *mut c_void;

    unsafe {
        let (out_ptr, out_len) = engine
            .compress_single_shot(
                CompressionAlgorithm::Zstd,
                sample_json.as_ptr(),
                sample_json.len(),
                ctx,
                mock_host_alloc,
            )
            .expect("compression must succeed");

        assert!(!out_ptr.is_null());
        assert!(out_len > 0 && out_len < sample_json.len());

        let compressed_slice = std::slice::from_raw_parts(out_ptr, out_len);
        let decompressed = zstd::bulk::decompress(compressed_slice, sample_json.len()).unwrap();
        assert_eq!(decompressed, sample_json);
    }
}
