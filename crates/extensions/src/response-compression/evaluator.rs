//! Egress Response Compression Evaluator
//!
//! Sub-microsecond header inspection, zero-alloc SWAR Accept-Encoding negotiation,
//! and zero-copy pointer compression into host memory pools.

use crate::response_compression::compressor::{
    compress_into, max_compressed_len, CompressionAlgorithm,
};
use crate::response_compression::policy::{ResponseCompressionConfig, RouteCompressionOverride};
use aurora_engine::radix::PathRadixTree;
use std::collections::HashSet;
use std::ffi::c_void;

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
}

/// Zero-allocation fast scanner for `Accept-Encoding` header value.
///
/// Detects support for `gzip`, `br` (brotli), and `zstd` while respecting `q=0` rejections.
pub fn parse_accept_encoding_mask(header_val: &str) -> u8 {
    let mut mask = 0u8;
    for part in header_val.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut token = trimmed;
        let mut qvalue_zero = false;

        if let Some((tok, params)) = trimmed.split_once(';') {
            token = tok.trim();
            for param in params.split(';') {
                let p = param.trim();
                if let Some(val) = p.strip_prefix("q=") {
                    let v = val.trim();
                    if (v.starts_with('0') && !v.starts_with("0."))
                        || v == "0.0"
                        || v == "0.00"
                        || v == "0.000"
                    {
                        qvalue_zero = true;
                    }
                }
            }
        }

        if qvalue_zero {
            continue;
        }

        if token.eq_ignore_ascii_case("zstd") {
            mask |= CLIENT_ENCODING_ZSTD;
        } else if token.eq_ignore_ascii_case("br") || token.eq_ignore_ascii_case("brotli") {
            mask |= CLIENT_ENCODING_BR;
        } else if token.eq_ignore_ascii_case("gzip") || token == "*" {
            mask |= CLIENT_ENCODING_GZIP;
        }
    }

    mask
}

/// Compiled policy container for sub-microsecond evaluation.
#[derive(Clone)]
pub struct ResponseCompressionEngine {
    pub config: ResponseCompressionConfig,
    allowed_types: HashSet<String>,
    wildcard_types: bool,
    route_overrides: PathRadixTree<RouteCompressionOverride>,
}

impl ResponseCompressionEngine {
    /// Creates and compiles a new engine from declarative configuration.
    pub fn new(config: ResponseCompressionConfig) -> Result<Self, String> {
        config.validate()?;

        let mut allowed_types = HashSet::new();
        let mut wildcard_types = false;

        for mime in config.sanitized_types() {
            if mime == "*" {
                wildcard_types = true;
            } else {
                allowed_types.insert(mime);
            }
        }

        let mut route_overrides = PathRadixTree::new();
        for override_rule in &config.routes_override {
            route_overrides.insert(override_rule.path_prefix.as_bytes(), override_rule.clone());
        }

        Ok(Self {
            config,
            allowed_types,
            wildcard_types,
            route_overrides,
        })
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

        // Check Content-Type eligibility
        if !self.wildcard_types {
            let base_mime = content_type
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();

            if base_mime.is_empty() || !self.allowed_types.contains(&base_mime) {
                return HeaderDecision::passthrough();
            }
        }

        // Parse client Accept-Encoding
        let mask = parse_accept_encoding_mask(accept_encoding);
        if mask == 0 {
            return HeaderDecision::passthrough();
        }

        // Select first matching algorithm according to preference order
        for algo in effective_prefer_algos {
            match algo.to_ascii_lowercase().as_str() {
                "zstd" if mask & CLIENT_ENCODING_ZSTD != 0 => {
                    return HeaderDecision {
                        action: HeaderDecisionAction::Compress,
                        algorithm: CompressionAlgorithm::Zstd,
                        content_encoding: "zstd",
                    };
                }
                "br" | "brotli" if mask & CLIENT_ENCODING_BR != 0 => {
                    return HeaderDecision {
                        action: HeaderDecisionAction::Compress,
                        algorithm: CompressionAlgorithm::Brotli,
                        content_encoding: "br",
                    };
                }
                "gzip" if mask & CLIENT_ENCODING_GZIP != 0 => {
                    return HeaderDecision {
                        action: HeaderDecisionAction::Compress,
                        algorithm: CompressionAlgorithm::Gzip,
                        content_encoding: "gzip",
                    };
                }
                _ => {}
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

    /// Single-shot zero-copy body compression.
    ///
    /// Allocates memory directly within host pool (e.g. `ngx_pnalloc(r->pool, size)`),
    /// executes SIMD compression, and hands over destination pointer directly.
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

        let compressed_len = compress_into(algorithm, level, input_slice, out_slice)?;
        Ok((out_ptr, compressed_len))
    }
}
