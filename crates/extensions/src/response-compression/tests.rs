//! Exhaustive test suite for Response Compression extension.

use super::compressor::CompressionAlgorithm;
use super::evaluator::{
    CLIENT_ENCODING_BR, CLIENT_ENCODING_GZIP, CLIENT_ENCODING_ZSTD, HeaderDecisionAction,
    ResponseCompressionEngine, is_application_json, is_text_css_or_xml, is_text_plain,
    parse_accept_encoding_mask, scan_accept_encoding_swar,
};
use super::policy::{ResponseCompressionConfig, RouteCompressionOverride};
use std::ffi::c_void;
use std::io::Read;

#[test]
fn test_packed_integer_arithmetic_mime_matching() {
    // 1. application/json (16 bytes packed u128)
    assert!(is_application_json(b"application/json"));
    assert!(is_application_json(b"Application/JSON"));
    assert!(is_application_json(b"APPLICATION/JSON"));
    assert!(is_application_json(b"aPpLiCaTiOn/JsOn"));
    assert!(!is_application_json(b"application/json1"));
    assert!(!is_application_json(b"applicat/json"));
    assert!(!is_application_json(b"application/xml"));
    assert!(!is_application_json(b"application/grpc"));

    // 2. text/css and text/xml (8 bytes packed u64)
    assert!(is_text_css_or_xml(b"text/css"));
    assert!(is_text_css_or_xml(b"Text/CSS"));
    assert!(is_text_css_or_xml(b"TEXT/CSS"));
    assert!(is_text_css_or_xml(b"text/xml"));
    assert!(is_text_css_or_xml(b"Text/XML"));
    assert!(is_text_css_or_xml(b"TEXT/XML"));
    assert!(!is_text_css_or_xml(b"text/xyz"));
    assert!(!is_text_css_or_xml(b"text/cs"));
    assert!(!is_text_css_or_xml(b"text/css1"));

    // 3. text/plain (10 bytes packed u64 + u16)
    assert!(is_text_plain(b"text/plain"));
    assert!(is_text_plain(b"Text/Plain"));
    assert!(is_text_plain(b"TEXT/PLAIN"));
    assert!(is_text_plain(b"tExT/pLaIn"));
    assert!(!is_text_plain(b"text/playn"));
    assert!(!is_text_plain(b"text/plain1"));
    assert!(!is_text_plain(b"text/html"));
}

#[test]
fn test_accept_encoding_swar_and_mask_parsing() {
    assert_eq!(
        parse_accept_encoding_mask("gzip, deflate, br, zstd"),
        CLIENT_ENCODING_GZIP | CLIENT_ENCODING_BR | CLIENT_ENCODING_ZSTD
    );

    assert_eq!(parse_accept_encoding_mask("gzip"), CLIENT_ENCODING_GZIP);
    assert_eq!(parse_accept_encoding_mask("br"), CLIENT_ENCODING_BR);
    assert_eq!(parse_accept_encoding_mask("zstd"), CLIENT_ENCODING_ZSTD);
    assert_eq!(parse_accept_encoding_mask("brotli"), CLIENT_ENCODING_BR);

    // Mixed case and whitespace
    assert_eq!(
        scan_accept_encoding_swar(b"   GZIP ,  BR  ;  q=0.9 ,  ZSTD  "),
        CLIENT_ENCODING_GZIP | CLIENT_ENCODING_BR | CLIENT_ENCODING_ZSTD
    );

    // Q-value = 0 rejections
    assert_eq!(
        parse_accept_encoding_mask("gzip;q=0, br;q=1.0"),
        CLIENT_ENCODING_BR
    );
    assert_eq!(
        parse_accept_encoding_mask("zstd;q=0.0, gzip;q=0.5"),
        CLIENT_ENCODING_GZIP
    );
    assert_eq!(
        parse_accept_encoding_mask("zstd;q=0.00, br;q=0.000, gzip"),
        CLIENT_ENCODING_GZIP
    );

    // Wildcard fallback
    assert_eq!(parse_accept_encoding_mask("*"), CLIENT_ENCODING_GZIP);

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
    let dec = engine.evaluate_header("/api/v1/users", 200, "APPLICATION/JSON", 2048, "gzip, br");
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Brotli);
    assert_eq!(dec.content_encoding, "br");

    // 3. Client supports only gzip -> should choose gzip
    let dec = engine.evaluate_header(
        "/api/v1/users",
        200,
        "text/plain; charset=iso-8859-1",
        2048,
        "gzip",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);
    assert_eq!(dec.algorithm, CompressionAlgorithm::Gzip);
    assert_eq!(dec.content_encoding, "gzip");

    // 4. Client doesn't support compression -> Passthrough
    let dec = engine.evaluate_header("/api/v1/users", 200, "text/css", 2048, "identity");
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 5. Status code 204 No Content -> Passthrough
    let dec = engine.evaluate_header("/api/v1/users", 204, "application/json", 0, "gzip, zstd");
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 6. Content length below min_length -> Passthrough
    let dec = engine.evaluate_header("/api/v1/users", 200, "application/json", 256, "gzip, zstd");
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);

    // 7. Non-compressible MIME type -> Passthrough
    let dec = engine.evaluate_header("/api/v1/image.png", 200, "image/png", 8192, "gzip, zstd");
    assert_eq!(dec.action, HeaderDecisionAction::Passthrough);
}

#[test]
fn test_custom_mime_types_hash_matching() {
    let config = ResponseCompressionConfig {
        enabled: true,
        min_length: 128,
        types: vec![
            "application/custom+json".into(),
            "application/vnd.api+json".into(),
        ],
        prefer_algorithms: vec!["zstd".into()],
        ..Default::default()
    };
    let engine = ResponseCompressionEngine::new(config).unwrap();

    let dec = engine.evaluate_header("/custom", 200, "application/custom+json", 512, "zstd");
    assert_eq!(dec.action, HeaderDecisionAction::Compress);

    let dec = engine.evaluate_header(
        "/custom",
        200,
        "APPLICATION/VND.API+JSON; charset=utf-8",
        512,
        "zstd",
    );
    assert_eq!(dec.action, HeaderDecisionAction::Compress);

    let dec = engine.evaluate_header("/custom", 200, "application/other+json", 512, "zstd");
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
    let dec = engine.evaluate_header("/static/app.css", 200, "text/css", 256, "zstd, br, gzip");
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
fn test_zero_copy_single_shot_compression_handover_all_algorithms() {
    let config = ResponseCompressionConfig::default();
    let engine = ResponseCompressionEngine::new(config).unwrap();

    let sample_json = br#"{"event":"purchase","item_id":9921,"price":149.99,"customer":"Alice","description":"High performance enterprise gateway response with simulated realistic payload length for compression ratio testing","details":{"items":[{"id":1,"name":"Item A","qty":10},{"id":2,"name":"Item B","qty":5}],"meta":{"processed_by":"aurora","cluster":"east-1"}}}"#;

    // 1. ZSTD
    {
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
                .expect("Zstd compression must succeed");

            assert!(!out_ptr.is_null());
            assert!(out_len > 0 && out_len < sample_json.len());

            let compressed_slice = std::slice::from_raw_parts(out_ptr, out_len);
            let decompressed = zstd::bulk::decompress(compressed_slice, sample_json.len()).unwrap();
            assert_eq!(decompressed, sample_json);
        }
    }

    // 2. BROTLI
    {
        let mut arena: Vec<Vec<u8>> = Vec::new();
        let ctx = &mut arena as *mut _ as *mut c_void;
        unsafe {
            let (out_ptr, out_len) = engine
                .compress_single_shot(
                    CompressionAlgorithm::Brotli,
                    sample_json.as_ptr(),
                    sample_json.len(),
                    ctx,
                    mock_host_alloc,
                )
                .expect("Brotli compression must succeed");

            assert!(!out_ptr.is_null());
            assert!(out_len > 0 && out_len < sample_json.len());

            let compressed_slice = std::slice::from_raw_parts(out_ptr, out_len);
            let mut decompressed = Vec::new();
            brotli::BrotliDecompress(&mut &compressed_slice[..], &mut decompressed).unwrap();
            assert_eq!(decompressed.as_slice(), sample_json);
        }
    }

    // 3. GZIP
    {
        let mut arena: Vec<Vec<u8>> = Vec::new();
        let ctx = &mut arena as *mut _ as *mut c_void;
        unsafe {
            let (out_ptr, out_len) = engine
                .compress_single_shot(
                    CompressionAlgorithm::Gzip,
                    sample_json.as_ptr(),
                    sample_json.len(),
                    ctx,
                    mock_host_alloc,
                )
                .expect("Gzip compression must succeed");

            assert!(!out_ptr.is_null());
            assert!(out_len > 0 && out_len < sample_json.len());

            let compressed_slice = std::slice::from_raw_parts(out_ptr, out_len);
            let mut decoder = flate2::read::GzDecoder::new(compressed_slice);
            let mut decompressed = Vec::new();
            decoder.read_to_end(&mut decompressed).unwrap();
            assert_eq!(decompressed.as_slice(), sample_json);
        }
    }
}
