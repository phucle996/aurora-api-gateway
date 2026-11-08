//! Egress Response Compression Evaluator
//!
//! Sub-microsecond header inspection, zero-alloc SWAR/SIMD Accept-Encoding negotiation,
//! packed integer arithmetic Content-Type matching, and zero-copy pointer compression into host memory pools.

use crate::response_compression::compressor::{
    COMPRESSOR_TABLE, CompressionAlgorithm, CompressorFn, compress_none, max_compressed_len,
};
use crate::response_compression::policy::{ResponseCompressionConfig, RouteCompressionOverride};
use aurora_engine::hardware::probe_cpu_capabilities;
use aurora_engine::radix::PathRadixTree;
use std::ffi::c_void;

// ============================================================================
// 1. Bitmask Flags & Decision Types
// ============================================================================

pub const CLIENT_ENCODING_GZIP: u8 = 1 << 0;
pub const CLIENT_ENCODING_BR: u8 = 1 << 1;
pub const CLIENT_ENCODING_ZSTD: u8 = 1 << 2;

/// Outcome action for Header Filter phase.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderDecisionAction {
    Passthrough = 0,
    Compress = 1,
}

/// Decision outcome for response header filter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeaderDecision {
    pub action: HeaderDecisionAction,
    pub algorithm: CompressionAlgorithm,
    pub content_encoding: &'static str,
}

impl HeaderDecision {
    #[inline(always)]
    pub const fn passthrough() -> Self {
        Self {
            action: HeaderDecisionAction::Passthrough,
            algorithm: CompressionAlgorithm::None,
            content_encoding: "",
        }
    }

    #[inline(always)]
    pub const fn compress(algorithm: CompressionAlgorithm, content_encoding: &'static str) -> Self {
        Self {
            action: HeaderDecisionAction::Compress,
            algorithm,
            content_encoding,
        }
    }
}

/// Precompiled user-defined MIME type for arithmetic matching without string allocs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrecompiledMime {
    pub len: usize,
    pub hash: u64,
    pub bytes: Vec<u8>,
}

/// FNV-1a 64-bit numerical hash for case-insensitive MIME string matching.
#[inline(always)]
pub fn hash_mime_u64(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for &b in bytes {
        h ^= (b | 0x20) as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Trims leading and trailing ASCII whitespace (spaces and tabs) from a byte slice.
#[inline(always)]
fn trim_ascii_whitespace(bytes: &[u8]) -> &[u8] {
    let mut s = 0;
    while s < bytes.len() && (bytes[s] == b' ' || bytes[s] == b'\t') {
        s += 1;
    }
    let mut e = bytes.len();
    while e > s && (bytes[e - 1] == b' ' || bytes[e - 1] == b'\t') {
        e -= 1;
    }
    &bytes[s..e]
}

// ============================================================================
// 2. Packed Integer Arithmetic MIME Constants & Fast Filters
// ============================================================================

// 16-byte Little-Endian constant for b"application/json"
pub const JSON_U128: u128 = u128::from_le_bytes(*b"application/json");

// 8-byte Little-Endian constants for b"text/css" and b"text/xml"
pub const CSS_U64: u64 = u64::from_le_bytes(*b"text/css");
pub const XML_U64: u64 = u64::from_le_bytes(*b"text/xml");

// 10-byte constants for b"text/plain" (8 bytes + 2 bytes)
pub const PLAIN_W0: u64 = u64::from_le_bytes(*b"text/pla");
pub const PLAIN_W1: u16 = u16::from_le_bytes(*b"in");

/// Packed 128-bit integer comparison for `"application/json"` with case normalization in 1 CPU cycle.
#[inline(always)]
pub fn is_application_json(mime: &[u8]) -> bool {
    if mime.len() != 16 {
        return false;
    }
    let val = unsafe { (mime.as_ptr() as *const u128).read_unaligned() };
    let norm = val | 0x20202020_20202020_20202020_20202020_u128;
    norm == JSON_U128
}

/// Packed 64-bit integer comparison for `"text/css"` and `"text/xml"` with case normalization.
#[inline(always)]
pub fn is_text_css_or_xml(mime: &[u8]) -> bool {
    if mime.len() != 8 {
        return false;
    }
    let val = unsafe { (mime.as_ptr() as *const u64).read_unaligned() };
    let norm = val | 0x20202020_20202020_u64;
    norm == CSS_U64 || norm == XML_U64
}

/// Packed 64-bit + 16-bit integer comparison for `"text/plain"` with case normalization.
#[inline(always)]
pub fn is_text_plain(mime: &[u8]) -> bool {
    if mime.len() != 10 {
        return false;
    }
    let w0 = unsafe { (mime.as_ptr() as *const u64).read_unaligned() } | 0x20202020_20202020_u64;
    let w1 = unsafe { (mime.as_ptr().add(8) as *const u16).read_unaligned() } | 0x2020_u16;
    w0 == PLAIN_W0 && w1 == PLAIN_W1
}

pub type MimeMatcherFn = fn(mime: &[u8], len_mask: u64, custom: &[PrecompiledMime]) -> bool;

/// Primary arithmetic MIME matcher using length bitmask and packed integer word comparisons.
pub fn match_mime_swar(mime: &[u8], len_mask: u64, custom: &[PrecompiledMime]) -> bool {
    let len = mime.len();
    if len == 0 || len >= 64 || (len_mask & (1u64 << len)) == 0 {
        return false;
    }
    match len {
        16 if is_application_json(mime) => true,
        8 if is_text_css_or_xml(mime) => true,
        10 if is_text_plain(mime) => true,
        _ => {
            let h = hash_mime_u64(mime);
            custom
                .iter()
                .any(|c| c.len == len && c.hash == h && c.bytes.eq_ignore_ascii_case(mime))
        }
    }
}

pub fn match_mime_sse(mime: &[u8], len_mask: u64, custom: &[PrecompiledMime]) -> bool {
    match_mime_swar(mime, len_mask, custom)
}

pub fn match_mime_avx2(mime: &[u8], len_mask: u64, custom: &[PrecompiledMime]) -> bool {
    match_mime_swar(mime, len_mask, custom)
}

// ============================================================================
// 3. Zero-Allocation Accept-Encoding Scanner
// ============================================================================

pub type AcceptEncodingScannerFn = fn(header: &[u8]) -> u8;

/// Fast zero-allocation byte slice scanner for `Accept-Encoding` header value.
///
/// Uses packed Little-Endian integer equality for `"zstd"`, `"gzip"`, `"br"`,
/// respecting `q=0` client rejections.
pub fn scan_accept_encoding_swar(header: &[u8]) -> u8 {
    let mut mask = 0u8;
    for part in header.split(|&b| b == b',') {
        let trimmed = trim_ascii_whitespace(part);
        if trimmed.is_empty() {
            continue;
        }

        let (token, params) = match memchr::memchr(b';', trimmed) {
            Some(idx) => (&trimmed[..idx], Some(&trimmed[idx + 1..])),
            None => (trimmed, None),
        };

        let tok = trim_ascii_whitespace(token);

        let mut qzero = false;
        if let Some(params) = params {
            for param in params.split(|&b| b == b';') {
                let p = trim_ascii_whitespace(param);
                if p.starts_with(b"q=") {
                    let v = &p[2..];
                    if (v.starts_with(b"0") && !v.starts_with(b"0."))
                        || v == b"0.0"
                        || v == b"0.00"
                        || v == b"0.000"
                    {
                        qzero = true;
                        break;
                    }
                }
            }
        }

        if qzero {
            continue;
        }

        match tok.len() {
            4 => {
                let w = unsafe { (tok.as_ptr() as *const u32).read_unaligned() } | 0x20202020;
                if w == 0x6474737A {
                    mask |= CLIENT_ENCODING_ZSTD; // "zstd"
                } else if w == 0x70697A67 {
                    mask |= CLIENT_ENCODING_GZIP; // "gzip"
                }
            }
            2 => {
                let w = unsafe { (tok.as_ptr() as *const u16).read_unaligned() } | 0x2020;
                if w == 0x7262 {
                    mask |= CLIENT_ENCODING_BR; // "br"
                }
            }
            6 if tok.eq_ignore_ascii_case(b"brotli") => {
                mask |= CLIENT_ENCODING_BR;
            }
            1 if tok[0] == b'*' => {
                mask |= CLIENT_ENCODING_GZIP;
            }
            _ => {}
        }
    }
    mask
}

pub fn scan_accept_encoding_sse(header: &[u8]) -> u8 {
    scan_accept_encoding_swar(header)
}

pub fn scan_accept_encoding_avx2(header: &[u8]) -> u8 {
    scan_accept_encoding_swar(header)
}

/// Backward compatible string wrapper for `Accept-Encoding` parsing.
#[inline(always)]
pub fn parse_accept_encoding_mask(header_val: &str) -> u8 {
    scan_accept_encoding_swar(header_val.as_bytes())
}

// ============================================================================
// 4. Compiled Engine Container & Egress Evaluation
// ============================================================================

/// Compiled policy container for sub-microsecond evaluation.
#[derive(Clone)]
pub struct ResponseCompressionEngine {
    pub config: ResponseCompressionConfig,
    vector_width_bytes: usize,
    allowed_len_mask: u64,
    custom_mimes: Vec<PrecompiledMime>,
    wildcard_types: bool,
    route_overrides: PathRadixTree<RouteCompressionOverride>,
    parse_ae_fn: AcceptEncodingScannerFn,
    match_mime_fn: MimeMatcherFn,
    compressors: [CompressorFn; 4],
}

impl ResponseCompressionEngine {
    /// Creates and compiles a new engine from declarative configuration.
    pub fn new(config: ResponseCompressionConfig) -> Result<Self, String> {
        config.validate()?;

        let mut custom_mimes = Vec::new();
        let mut wildcard_types = false;
        let mut allowed_len_mask = 0u64;

        for mime in config.sanitized_types() {
            if mime == "*" {
                wildcard_types = true;
            } else {
                let bytes = mime.into_bytes();
                let len = bytes.len();
                if len < 64 {
                    allowed_len_mask |= 1u64 << len;
                }
                let hash = hash_mime_u64(&bytes);
                custom_mimes.push(PrecompiledMime { len, hash, bytes });
            }
        }

        let mut route_overrides = PathRadixTree::new();
        for override_rule in &config.routes_override {
            route_overrides.insert(override_rule.path_prefix.as_bytes(), override_rule.clone());
        }

        let caps = probe_cpu_capabilities();
        let vector_width_bytes = caps.safe_vector_width_bytes();

        let (parse_ae_fn, match_mime_fn): (AcceptEncodingScannerFn, MimeMatcherFn) =
            match vector_width_bytes {
                32 => (scan_accept_encoding_avx2, match_mime_avx2),
                16 => (scan_accept_encoding_sse, match_mime_sse),
                _ => (scan_accept_encoding_swar, match_mime_swar),
            };

        Ok(Self {
            config,
            vector_width_bytes,
            allowed_len_mask,
            custom_mimes,
            wildcard_types,
            route_overrides,
            parse_ae_fn,
            match_mime_fn,
            compressors: COMPRESSOR_TABLE,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.config.generation
    }

    #[inline]
    pub fn vector_width_bytes(&self) -> usize {
        self.vector_width_bytes
    }

    /// Evaluates egress response headers and negotiates the optimal compression algorithm.
    pub fn evaluate_header(
        &self,
        path: &str,
        status: u32,
        content_type: &str,
        content_length: usize,
        accept_encoding: &str,
    ) -> HeaderDecision {
        if !self.config.enabled {
            return HeaderDecision::passthrough();
        }

        // Do not compress status codes with empty bodies or no-transform semantics
        if status == 204 || status == 304 || status < 200 {
            return HeaderDecision::passthrough();
        }

        // Resolve route override if defined (longest matching prefix)
        let mut effective_enabled = self.config.enabled;
        let mut effective_min_length = self.config.min_length;
        let mut effective_prefer_algos = &self.config.prefer_algorithms;

        let mut best_override: Option<&RouteCompressionOverride> = None;
        let mut best_prefix_len = 0;
        self.route_overrides.for_each_match(path.as_bytes(), |val| {
            if val.path_prefix.len() >= best_prefix_len {
                best_override = Some(val);
                best_prefix_len = val.path_prefix.len();
            }
        });

        if let Some(rule) = best_override {
            if let Some(en) = rule.enabled {
                effective_enabled = en;
            }
            if let Some(ml) = rule.min_length {
                effective_min_length = ml;
            }
            if let Some(algos) = &rule.prefer_algorithms {
                effective_prefer_algos = algos;
            }
        }

        if !effective_enabled {
            return HeaderDecision::passthrough();
        }

        // If content length is known and below min_length, pass through
        if content_length > 0 && content_length < effective_min_length {
            return HeaderDecision::passthrough();
        }

        // Check Content-Type eligibility via zero-alloc arithmetic matching
        if !self.wildcard_types {
            let ct_bytes = content_type.as_bytes();
            let end_idx = memchr::memchr(b';', ct_bytes).unwrap_or(ct_bytes.len());
            let base_mime = trim_ascii_whitespace(&ct_bytes[..end_idx]);

            if base_mime.is_empty()
                || !(self.match_mime_fn)(base_mime, self.allowed_len_mask, &self.custom_mimes)
            {
                return HeaderDecision::passthrough();
            }
        }

        // Parse client Accept-Encoding via resolved SIMD/SWAR function pointer
        let mask = (self.parse_ae_fn)(accept_encoding.as_bytes());
        if mask == 0 {
            return HeaderDecision::passthrough();
        }

        // Select first matching algorithm according to preference order (zero allocs)
        for algo in effective_prefer_algos {
            if algo.eq_ignore_ascii_case("zstd") && (mask & CLIENT_ENCODING_ZSTD != 0) {
                return HeaderDecision::compress(CompressionAlgorithm::Zstd, "zstd");
            }
            if (algo.eq_ignore_ascii_case("br") || algo.eq_ignore_ascii_case("brotli"))
                && (mask & CLIENT_ENCODING_BR != 0)
            {
                return HeaderDecision::compress(CompressionAlgorithm::Brotli, "br");
            }
            if algo.eq_ignore_ascii_case("gzip") && (mask & CLIENT_ENCODING_GZIP != 0) {
                return HeaderDecision::compress(CompressionAlgorithm::Gzip, "gzip");
            }
        }

        HeaderDecision::passthrough()
    }

    /// Obtains configured compression level for the specified algorithm.
    #[inline(always)]
    pub fn get_level(&self, algorithm: CompressionAlgorithm) -> u32 {
        match algorithm {
            CompressionAlgorithm::None => 0,
            CompressionAlgorithm::Zstd => self.config.zstd_level,
            CompressionAlgorithm::Brotli => self.config.brotli_level,
            CompressionAlgorithm::Gzip => self.config.gzip_level,
        }
    }

    // ========================================================================
    // 5. Single-Shot Zero-Copy Pointer Compression
    // ========================================================================

    /// Single-shot zero-copy body compression.
    ///
    /// Allocates memory directly within host pool (e.g. `ngx_pnalloc(r->pool, size)`),
    /// executes SIMD compression via direct indexed function pointer, and hands over destination pointer directly.
    ///
    /// # Safety
    /// `alloc_fn` must be a valid C-ABI allocator function and `in_ptr` must point to `in_len` bytes.
    pub unsafe fn compress_single_shot(
        &self,
        algorithm: CompressionAlgorithm,
        in_ptr: *const u8,
        in_len: usize,
        alloc_ctx: *mut c_void,
        alloc_fn: unsafe extern "C" fn(ctx: *mut c_void, size: usize) -> *mut u8,
    ) -> Result<(*mut u8, usize), String> {
        if in_len == 0 || in_ptr.is_null() {
            return Ok((std::ptr::null_mut(), 0));
        }

        let input_slice = unsafe { std::slice::from_raw_parts(in_ptr, in_len) };
        let bound = max_compressed_len(algorithm, in_len);

        let out_ptr = unsafe { alloc_fn(alloc_ctx, bound) };
        if out_ptr.is_null() {
            return Err(format!("host pool allocation failed for {bound} bytes"));
        }

        let out_slice = unsafe { std::slice::from_raw_parts_mut(out_ptr, bound) };
        let level = self.get_level(algorithm);

        let algo_idx = algorithm as usize;
        let compressor = if algo_idx < self.compressors.len() {
            self.compressors[algo_idx]
        } else {
            compress_none
        };

        let compressed_len = compressor(level, input_slice, out_slice)?;
        Ok((out_ptr, compressed_len))
    }
}
