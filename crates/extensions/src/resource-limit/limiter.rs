//! Resource Limiter Execution Engine
//!
//! Enforces dual header and payload bounds via 1-instruction SIMD vector comparisons
//! and branchless status code selection.

use super::config::{ResourceLimitDecision, ResourceLimitRequest, ResourceLimitSnapshot};
use super::rule::{CompiledResourceRule, HostMatcher};
use crate::{AccessRequestContext, Error, MAX_PATH_BYTES, MAX_POLICY_BYTES, host_specificity};
use std::collections::HashSet;

pub struct ResourceLimiter {
    generation: u64,
    rules: Vec<CompiledResourceRule>,
}

impl ResourceLimiter {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let snapshot: ResourceLimitSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > 64 {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = HashSet::with_capacity(snapshot.rules.len());
        for rule in &snapshot.rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }

        let mut input_rules = snapshot.rules;
        input_rules.sort_by_key(|r| (r.priority, host_specificity(&r.origin), r.id.clone()));

        let mut rules = Vec::with_capacity(input_rules.len());
        for rule in input_rules {
            let host_matcher = HostMatcher::parse(&rule.origin).ok_or(Error::InvalidPolicy)?;

            if !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule
                    .path_prefix
                    .bytes()
                    .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
                || rule.path_prefix.contains("//")
                || rule.path_prefix.split('/').any(|s| s == "." || s == "..")
            {
                return Err(Error::InvalidPolicy);
            }

            let raw_header_limit = if rule.header_limit > 0 {
                rule.header_limit
            } else {
                u64::MAX
            };

            let raw_payload_limit = if rule.payload_limit > 0 {
                rule.payload_limit
            } else {
                u64::MAX
            };

            // An unconstrained limit (0) is represented by i64::MAX for branchless x86 SIMD
            let effective_header_limit = if rule.header_limit > 0 {
                rule.header_limit.min(i64::MAX as u64) as i64
            } else {
                i64::MAX
            };

            let effective_payload_limit = if rule.payload_limit > 0 {
                rule.payload_limit.min(i64::MAX as u64) as i64
            } else {
                i64::MAX
            };

            // Branchless status code table:
            // [00 = OK (200), 01 = Header (431), 10 = Payload (413), 11 = Both (431)]
            let status_table = [
                200,
                rule.rejected_code_header,
                rule.rejected_code_payload,
                rule.rejected_code_header,
            ];

            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');
            let path_prefix = rule.path_prefix.into_bytes();

            rules.push(CompiledResourceRule {
                id: rule.id,
                priority: rule.priority,
                host: host_matcher,
                path_prefix,
                path_prefix_ends_with_slash,
                raw_header_limit,
                raw_payload_limit,
                effective_header_limit,
                effective_payload_limit,
                status_table,
                response_body_header: rule.response_body_header.into_bytes(),
                response_body_payload: rule.response_body_payload.into_bytes(),
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    #[inline(always)]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline(always)]
    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }

    #[inline(always)]
    pub fn evaluate_ctx<'a>(&'a self, ctx: &AccessRequestContext<'a>) -> ResourceLimitDecision<'a> {
        self.evaluate(&ResourceLimitRequest {
            origin: ctx.host,
            path: ctx.path,
            header_bytes: ctx.header_length,
            payload_bytes: ctx.content_length,
        })
    }

    pub fn evaluate<'a>(&'a self, req: &ResourceLimitRequest<'a>) -> ResourceLimitDecision<'a> {
        if req.origin.is_empty()
            || req.origin.len() > 253
            || req.path.is_empty()
            || req.path.len() > MAX_PATH_BYTES
            || !req.path.starts_with(b"/")
        {
            return ResourceLimitDecision::allow();
        }

        for rule in &self.rules {
            if !rule.matches_host_and_path(req.origin, req.path) {
                continue;
            }

            // 1 SIMD instruction checks both header and payload bounds simultaneously
            let violation_mask = rule.check_limits_simd(req.header_bytes, req.payload_bytes);

            // Branchless status table lookup
            if violation_mask != 0 {
                let status = rule.status_table[violation_mask as usize];
                let body = rule.select_body(violation_mask);
                return ResourceLimitDecision::reject(status, body, rule.id.as_str());
            }

            // Rule matched and all limits satisfied
            return ResourceLimitDecision::allow();
        }

        ResourceLimitDecision::allow()
    }
}
