//! WAF Lite High-Performance Vectorized Evaluation Engine
//!
//! Fully decoupled Dataplane: receives user-configured string patterns, compiles them
//! into vector search automata (AVX2 256-bit / NEON 128-bit / SWAR 64-bit), and scans
//! incoming requests with zero heap allocations on the hot path.

use super::config::{MAX_WAF_POLICY_BYTES, WafLiteSnapshot, WafMode};
use crate::{AccessRequestContext, Decision, Error, MAX_PATH_BYTES};
use aho_corasick::{AhoCorasick, AhoCorasickBuilder};
use aurora_engine::hardware::probe_cpu_capabilities;
use std::hash::Hasher;

/// Branchless hexadecimal decode lookup table (256 bytes = 4 L1D cache lines).
/// Contains 0..=15 for valid hex characters, 0xFF for invalid bytes.
const HEX_LUT: [u8; 256] = {
    let mut table = [0xFF; 256];
    let mut i = 0u8;
    while i < 10 {
        table[(b'0' + i) as usize] = i;
        i += 1;
    }
    let mut i = 0u8;
    while i < 6 {
        table[(b'a' + i) as usize] = 10 + i;
        table[(b'A' + i) as usize] = 10 + i;
        i += 1;
    }
    table
};

#[inline]
pub fn url_decode_into<'a>(src: &[u8], dst: &'a mut [u8]) -> Option<&'a [u8]> {
    url_decode_into_from(src, dst, 0)
}

/// High-performance URL decoder with branchless hex parsing and SIMD prefix skip.
#[inline]
pub fn url_decode_into_from<'a>(
    src: &[u8],
    dst: &'a mut [u8],
    first_evasion_pos: usize,
) -> Option<&'a [u8]> {
    if src.len() > dst.len() {
        return None;
    }

    let prefix_len = first_evasion_pos.min(src.len());
    // Fast path: bulk SIMD copy all clean prefix bytes prior to first '%' or '+'
    if prefix_len > 0 {
        dst[..prefix_len].copy_from_slice(&src[..prefix_len]);
    }

    let mut s = prefix_len;
    let mut d = prefix_len;

    while s < src.len() {
        if src[s] == b'%' && s + 2 < src.len() {
            let v1 = HEX_LUT[src[s + 1] as usize];
            let v2 = HEX_LUT[src[s + 2] as usize];
            // Branchless check: if both v1 and v2 are <= 15, then (v1 | v2) <= 15
            if (v1 | v2) <= 0x0F {
                dst[d] = (v1 << 4) | v2;
                s += 3;
                d += 1;
                continue;
            }
        }

        // Branchless plus substitution: '+' -> ' ', other bytes preserved
        let c = src[s];
        let is_plus = (c == b'+') as u8;
        dst[d] = c ^ (is_plus * (b'+' ^ b' '));
        s += 1;
        d += 1;
    }

    Some(&dst[..d])
}

/// Maximum number of exact-match whitelist paths supported in fixed CPU registers.
pub const MAX_WHITELIST_PATHS: usize = 16;

/// Fast 64-bit numerical hash for exact-match path lookup on the CPU.
#[inline(always)]
pub fn hash_path_u64(bytes: &[u8]) -> u64 {
    let mut hasher = rustc_hash::FxHasher::default();
    hasher.write(bytes);
    let h = hasher.finish();
    if h == 0 { 1 } else { h }
}

#[derive(Clone, Debug)]
pub struct WafLiteEngine {
    generation: u64,
    enabled: bool,
    mode: WafMode,
    block_action: u32,
    inspect_headers: bool,
    vector_width_bytes: usize,
    matcher: Option<AhoCorasick>,
    patterns_count: usize,
    whitelist_len_mask: u64,
    whitelist_hashes: [u64; MAX_WHITELIST_PATHS],
    whitelist_count: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct WafLiteRequest<'a> {
    pub path: &'a [u8],
    pub query: &'a [u8],
    pub host: &'a [u8],
    pub method: &'a [u8],
    pub client_ip: &'a [u8],
}

impl<'a> Default for WafLiteRequest<'a> {
    fn default() -> Self {
        Self {
            path: b"/",
            query: b"",
            host: b"",
            method: b"GET",
            client_ip: b"127.0.0.1",
        }
    }
}

impl WafLiteEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_WAF_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let snap: WafLiteSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snap.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        // Lock in host CPU vector capabilities once at boot (capped at 256-bit AVX2)
        let vector_width_bytes = probe_cpu_capabilities().safe_vector_width_bytes();

        let mut patterns = Vec::new();

        // 1. Collect from flat pattern list
        for p in snap.patterns {
            let trimmed = p.trim();
            if !trimmed.is_empty() && trimmed.len() <= 1024 {
                patterns.push(trimmed.to_string());
            }
        }

        // 2. Collect from structured rule list
        for r in snap.rules {
            let trimmed = r.pattern.trim();
            if !trimmed.is_empty() && trimmed.len() <= 1024 {
                patterns.push(trimmed.to_string());
            }
        }

        let patterns_count = patterns.len();

        // 3. Compile Aho-Corasick multi-pattern matcher if patterns exist
        let matcher = if patterns.is_empty() {
            None
        } else {
            let ac = AhoCorasickBuilder::new()
                .ascii_case_insensitive(true)
                .build(&patterns)
                .map_err(|_| Error::InvalidPolicy)?;
            Some(ac)
        };

        // 4. Numerical exact-match compilation for whitelist paths
        let mut whitelist_hashes = [0u64; MAX_WHITELIST_PATHS];
        let mut whitelist_len_mask = 0u64;
        let mut whitelist_count = 0;
        for p in snap.whitelist_paths {
            let trimmed = p.trim();
            if !trimmed.is_empty() && trimmed.starts_with('/') {
                let bytes = trimmed.as_bytes();
                let len = bytes.len();
                if len > 0 && len < 64 {
                    whitelist_len_mask |= 1u64 << len;
                }
                if whitelist_count < MAX_WHITELIST_PATHS {
                    whitelist_hashes[whitelist_count] = hash_path_u64(bytes);
                    whitelist_count += 1;
                }
            }
        }

        let block_action = u32::from(snap.mode == WafMode::Block);

        Ok(Self {
            generation: snap.generation,
            enabled: snap.enabled,
            mode: snap.mode,
            block_action,
            inspect_headers: snap.inspect_headers,
            vector_width_bytes,
            matcher,
            patterns_count,
            whitelist_len_mask,
            whitelist_hashes,
            whitelist_count,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline]
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    #[inline]
    pub fn mode(&self) -> WafMode {
        self.mode
    }

    #[inline]
    pub fn vector_width_bytes(&self) -> usize {
        self.vector_width_bytes
    }

    #[inline]
    pub fn patterns_count(&self) -> usize {
        self.patterns_count
    }

    #[inline(always)]
    fn is_whitelisted_hash(&self, target: u64) -> bool {
        if self.whitelist_count == 0 {
            return false;
        }
        // Fixed 8-element branchless arithmetic comparison in CPU registers
        let mut m = (self.whitelist_hashes[0] == target)
            | (self.whitelist_hashes[1] == target)
            | (self.whitelist_hashes[2] == target)
            | (self.whitelist_hashes[3] == target)
            | (self.whitelist_hashes[4] == target)
            | (self.whitelist_hashes[5] == target)
            | (self.whitelist_hashes[6] == target)
            | (self.whitelist_hashes[7] == target);

        if self.whitelist_count > 8 {
            for &h in &self.whitelist_hashes[8..self.whitelist_count.min(MAX_WHITELIST_PATHS)] {
                m |= h == target;
            }
        }
        m
    }

    #[inline(always)]
    fn is_whitelisted_path(&self, path: &[u8]) -> bool {
        if self.whitelist_count == 0 {
            return false;
        }
        let len = path.len();
        let len_matches = if len > 0 && len < 64 {
            (self.whitelist_len_mask & (1u64 << len)) != 0
        } else {
            len >= 64
        };
        len_matches && self.is_whitelisted_hash(hash_path_u64(path))
    }

    #[inline(always)]
    fn build_decision(&self, mat: aho_corasick::Match) -> Decision {
        Decision {
            rule_id: (mat.pattern().as_usize() + 1) as u64,
            action: self.block_action,
            log_matches: 1,
            generation: self.generation,
            ..Default::default()
        }
    }

    #[inline]
    pub fn evaluate_ctx<'h>(
        &self,
        ctx: &AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> Result<Decision, Error> {
        self.evaluate(
            WafLiteRequest {
                path: ctx.path,
                query: ctx.query,
                host: ctx.host,
                method: ctx.method,
                client_ip: ctx.client_ip,
            },
            header_lookup,
        )
    }

    pub fn evaluate<'h>(
        &self,
        req: WafLiteRequest<'_>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> Result<Decision, Error> {
        if !self.enabled {
            return Ok(Decision {
                action: 0,
                generation: self.generation,
                ..Default::default()
            });
        }

        if req.path.is_empty() || req.path.len() > MAX_PATH_BYTES || req.path[0] != b'/' {
            return Err(Error::InvalidRequest);
        }

        let matcher = match &self.matcher {
            Some(m) => m,
            None => {
                // No patterns configured -> clean allow
                return Ok(Decision {
                    action: 0,
                    generation: self.generation,
                    ..Default::default()
                });
            }
        };

        // =========================================================================
        // UNIFIED URL INSPECTION: Single-Pass Normalization, Whitelist & Attack Match
        // =========================================================================
        let mut stack_buf = [0u8; MAX_PATH_BYTES];

        // 1. Unified Path pass: detect '%', '+', or '?' in 1 single SIMD instruction
        match memchr::memchr3(b'%', b'+', b'?', req.path) {
            None => {
                // 1a. Clean Path (zero encoding, zero query delimiter): 99% of requests!
                if self.is_whitelisted_path(req.path) {
                    return Ok(Decision {
                        action: 0,
                        generation: self.generation,
                        ..Default::default()
                    });
                }
                if let Some(mat) = matcher.find(req.path) {
                    return Ok(self.build_decision(mat));
                }
            }
            Some(_) => {
                // 1b. Path has '%', '+', or '?' -> extract path segment and decode if necessary
                let (path_segment, inline_query) = match memchr::memchr(b'?', req.path) {
                    Some(q_pos) => (&req.path[..q_pos], &req.path[q_pos + 1..]),
                    None => (req.path, &b""[..]),
                };

                let canonical_path = if let Some(pos) = memchr::memchr2(b'%', b'+', path_segment) {
                    url_decode_into_from(path_segment, &mut stack_buf, pos).unwrap_or(path_segment)
                } else {
                    path_segment
                };

                // Whitelist check on normalized canonical path
                if self.is_whitelisted_path(canonical_path) {
                    return Ok(Decision {
                        action: 0,
                        generation: self.generation,
                        ..Default::default()
                    });
                }

                // Attack pattern matching on canonical path
                if let Some(mat) = matcher.find(canonical_path) {
                    return Ok(self.build_decision(mat));
                }
                if canonical_path.as_ptr() != path_segment.as_ptr()
                    && let Some(mat) = matcher.find(path_segment)
                {
                    return Ok(self.build_decision(mat));
                }

                // Scan inline query if present
                if !inline_query.is_empty() {
                    if let Some(mat) = matcher.find(inline_query) {
                        return Ok(self.build_decision(mat));
                    }
                    if let Some(q_pos) = memchr::memchr2(b'%', b'+', inline_query)
                        && let Some(decoded_q) =
                            url_decode_into_from(inline_query, &mut stack_buf, q_pos)
                        && let Some(mat) = matcher.find(decoded_q)
                    {
                        return Ok(self.build_decision(mat));
                    }
                }
            }
        }

        // 2. Query string inspection (from ctx.query)
        if !req.query.is_empty() {
            if let Some(mat) = matcher.find(req.query) {
                return Ok(self.build_decision(mat));
            }
            if let Some(q_pos) = memchr::memchr2(b'%', b'+', req.query)
                && req.query.len() <= stack_buf.len()
                && let Some(decoded_q) = url_decode_into_from(req.query, &mut stack_buf, q_pos)
                && let Some(mat) = matcher.find(decoded_q)
            {
                return Ok(self.build_decision(mat));
            }
        }

        // 2. Inspect sensitive HTTP Request Headers (Cookie, User-Agent, Referer, Authorization)
        if self.inspect_headers {
            let mut stack_hdr_buf = [0u8; 4096];
            for hdr_name in &[
                "user-agent",
                "cookie",
                "referer",
                "authorization",
                "x-forwarded-for",
            ] {
                if let Some(hdr_val) = header_lookup(hdr_name)
                    && !hdr_val.is_empty()
                {
                    // Scan raw header value
                    if let Some(mat) = matcher.find(hdr_val) {
                        return Ok(self.build_decision(mat));
                    }

                    // Scan URL-decoded header value (e.g. cookie encoded payloads)
                    if let Some(pos) = memchr::memchr2(b'%', b'+', hdr_val)
                        && hdr_val.len() <= stack_hdr_buf.len()
                        && let Some(decoded) =
                            url_decode_into_from(hdr_val, &mut stack_hdr_buf, pos)
                        && let Some(mat) = matcher.find(decoded)
                    {
                        return Ok(self.build_decision(mat));
                    }
                }
            }
        }

        // Clean pass
        Ok(Decision {
            action: 0,
            generation: self.generation,
            ..Default::default()
        })
    }
}
