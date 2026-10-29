//! Compiled Flat Resource Limit Rule Representation
//!
//! Stores pre-configured vector bounds [max_header, max_payload] and provides
//! 1-instruction SIMD vector comparisons and branchless status code selection.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostMatcher {
    Any,
    Exact(Vec<u8>),
    Suffix(Vec<u8>),
}

impl HostMatcher {
    pub fn parse(host_str: &str) -> Option<Self> {
        let s = host_str.trim();
        if s == "*" || s.is_empty() {
            Some(HostMatcher::Any)
        } else if let Some(sub) = s.strip_prefix("*.") {
            if sub.is_empty()
                || !sub
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            {
                None
            } else {
                Some(HostMatcher::Suffix(sub.as_bytes().to_vec()))
            }
        } else {
            if !s
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            {
                None
            } else {
                Some(HostMatcher::Exact(s.as_bytes().to_vec()))
            }
        }
    }

    #[inline(always)]
    pub fn matches(&self, req_host: &[u8]) -> bool {
        match self {
            HostMatcher::Any => true,
            HostMatcher::Exact(expected) => expected.as_slice() == req_host,
            HostMatcher::Suffix(suffix) => {
                if req_host.len() <= suffix.len() {
                    false
                } else if req_host.ends_with(suffix) {
                    let dot_pos = req_host.len() - suffix.len() - 1;
                    req_host[dot_pos] == b'.'
                } else {
                    false
                }
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct CompiledResourceRule {
    pub id: String,
    pub priority: u32,
    pub host: HostMatcher,
    pub path_prefix: Vec<u8>,
    pub path_prefix_ends_with_slash: bool,

    // Raw unsigned limits for portable comparison (0 = unconstrained, compiled to u64::MAX)
    pub raw_header_limit: u64,
    pub raw_payload_limit: u64,

    // Precomputed limits for x86 SIMD comparison (0 = unconstrained, compiled to i64::MAX)
    pub effective_header_limit: i64,
    pub effective_payload_limit: i64,

    // Status code lookup table: indexed by 2-bit violation mask [00, 01, 10, 11]
    pub status_table: [u16; 4],

    pub response_body_header: Vec<u8>,
    pub response_body_payload: Vec<u8>,
}

impl CompiledResourceRule {
    #[inline(always)]
    pub fn matches_host_and_path(&self, host: &[u8], path: &[u8]) -> bool {
        if !self.host.matches(host) {
            return false;
        }

        if path.len() < self.path_prefix.len() {
            return false;
        }
        if !path.starts_with(&self.path_prefix) {
            return false;
        }
        if self.path_prefix == b"/" || self.path_prefix_ends_with_slash {
            return true;
        }
        path.len() == self.path_prefix.len() || path[self.path_prefix.len()] == b'/'
    }

    /// Evaluates both header and payload limits in a single SIMD operation.
    /// Returns a 2-bit mask:
    /// - 0 (00b): No violations (OK)
    /// - 1 (01b): Header violated
    /// - 2 (10b): Payload violated
    /// - 3 (11b): Both violated
    #[inline(always)]
    pub fn check_limits_simd(&self, header_bytes: u64, payload_bytes: u64) -> u8 {
        #[cfg(all(target_arch = "x86_64", target_feature = "sse4.2"))]
        unsafe {
            use std::arch::x86_64::*;
            // Clamp to i64::MAX to prevent signed negative wrap-around on massive unsigned inputs
            let h = header_bytes.min(i64::MAX as u64) as i64;
            let p = payload_bytes.min(i64::MAX as u64) as i64;
            // Pack inputs and limits into 128-bit XMM vector registers
            let req = _mm_set_epi64x(p, h);
            let lim = _mm_set_epi64x(self.effective_payload_limit, self.effective_header_limit);
            // 1 SIMD instruction: VPCMPGTQ compares both 64-bit limits in parallel
            let cmp = _mm_cmpgt_epi64(req, lim);
            // Extract 2-bit comparison mask via cast to __m128d
            _mm_movemask_pd(_mm_castsi128_pd(cmp)) as u8
        }

        #[cfg(target_arch = "aarch64")]
        unsafe {
            use std::arch::aarch64::*;
            // Pack inputs and limits into 128-bit NEON vector registers (unsigned 64-bit lanes)
            let req = vcombine_u64(vcreate_u64(header_bytes), vcreate_u64(payload_bytes));
            let lim = vcombine_u64(
                vcreate_u64(self.raw_header_limit),
                vcreate_u64(self.raw_payload_limit),
            );
            // 1 SIMD instruction: VCGTQ.U64 compares both 64-bit unsigned bounds concurrently
            let cmp = vcgtq_u64(req, lim);
            // Extract 2-bit comparison mask: bit 0 = header, bit 1 = payload
            let h_mask = (vgetq_lane_u64::<0>(cmp) >> 63) as u8;
            let p_mask = (vgetq_lane_u64::<1>(cmp) >> 62) as u8;
            p_mask | h_mask
        }

        #[cfg(not(any(
            all(target_arch = "x86_64", target_feature = "sse4.2"),
            target_arch = "aarch64"
        )))]
        {
            // Fully portable branchless fallback using unsigned integer arithmetic
            let h_viol = (header_bytes > self.raw_header_limit) as u8;
            let p_viol = (payload_bytes > self.raw_payload_limit) as u8;
            (p_viol << 1) | h_viol
        }
    }

    #[inline(always)]
    pub fn select_body(&self, mask: u8) -> &[u8] {
        match mask {
            1 | 3 => &self.response_body_header,
            2 => &self.response_body_payload,
            _ => b"",
        }
    }
}
