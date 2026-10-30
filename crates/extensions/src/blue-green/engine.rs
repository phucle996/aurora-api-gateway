//! Dataplane Router Core Engine
//!
//! Orchestrates high-speed Access Phase route matching, SWAR slot parsing,
//! arithmetic security verification, and branchless L1 slot sheet retrieval.

use std::sync::Arc;
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

use super::policy::{
    BlueGreenRuleInput, BlueGreenSnapshot, CompiledBlueGreenRule, MAX_BLUE_GREEN_POLICY_BYTES,
    MAX_BLUE_GREEN_RULES,
};
use super::security::{
    extract_cookie_value, extract_query_value, verify_cidr_boundary, verify_preview_secret,
};
use super::sheet::{DeploySlot, SlotSheet, SlotUpstreamMeta, empty_blue_green_headers};
use super::swar::{fnv1a_64, parse_slot_swar, select_slot_branchless};

#[derive(Clone, Copy, Debug)]
pub struct BlueGreenEvalRequest<'a> {
    pub origin: &'a [u8],
    pub path: &'a [u8],
    pub client_ip: &'a [u8],
    pub query: &'a [u8],
}

impl<'a> BlueGreenEvalRequest<'a> {
    pub const fn new(origin: &'a [u8], path: &'a [u8]) -> Self {
        Self {
            origin,
            path,
            client_ip: b"",
            query: b"",
        }
    }

    pub const fn with_details(
        origin: &'a [u8],
        path: &'a [u8],
        client_ip: &'a [u8],
        query: &'a [u8],
    ) -> Self {
        Self {
            origin,
            path,
            client_ip,
            query,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlueGreenDecision<'a> {
    pub matched: bool,
    pub rule_id: &'a str,
    pub upstream: &'a str,
    pub active_slot: &'a str,
    pub is_header_override: bool,
    pub upstream_headers: &'a [(String, String)],
    pub headers_arc: Arc<[(String, String)]>,
}

impl<'a> BlueGreenDecision<'a> {
    pub fn unmatched() -> BlueGreenDecision<'static> {
        BlueGreenDecision {
            matched: false,
            rule_id: "",
            upstream: "",
            active_slot: "",
            is_header_override: false,
            upstream_headers: &[],
            headers_arc: empty_blue_green_headers(),
        }
    }

    pub fn matched(
        rule_id: &'a str,
        upstream: &'a str,
        active_slot: &'static str,
        is_header_override: bool,
        headers_arc: &'a Arc<[(String, String)]>,
    ) -> Self {
        Self {
            matched: true,
            rule_id,
            upstream,
            active_slot,
            is_header_override,
            upstream_headers: headers_arc.as_ref(),
            headers_arc: Arc::clone(headers_arc),
        }
    }
}

#[derive(Debug)]
pub struct BlueGreenEngine {
    generation: u64,
    rules: Vec<CompiledBlueGreenRule>,
}

#[inline(always)]
fn path_matches(prefix: &[u8], prefix_ends_with_slash: bool, path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix_ends_with_slash
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

impl BlueGreenEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_BLUE_GREEN_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: BlueGreenSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        // Support flat configuration as a single default rule
        if snapshot.rules.is_empty() {
            if let (Some(blue), Some(green)) = (
                snapshot.blue_upstream.take(),
                snapshot.green_upstream.take(),
            ) {
                snapshot.rules.push(BlueGreenRuleInput {
                    id: "default".to_string(),
                    priority: 100,
                    origin: "*".to_string(),
                    path_prefix: "/".to_string(),
                    active_slot: snapshot.active_slot.take(),
                    blue_upstream: blue,
                    green_upstream: green,
                    switch_header: snapshot.switch_header.take(),
                    preview_cookie: snapshot.preview_cookie.take(),
                    preview_query_param: snapshot.preview_query_param.take(),
                    preview_secret: snapshot.preview_secret.take(),
                    preview_secret_header: snapshot.preview_secret_header.take(),
                    allowed_cidrs: snapshot.allowed_cidrs,
                    blue_upstream_headers: snapshot.blue_upstream_headers,
                    green_upstream_headers: snapshot.green_upstream_headers,
                });
            } else {
                return Err(Error::InvalidPolicy);
            }
        }

        if snapshot.rules.len() > MAX_BLUE_GREEN_RULES {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = std::collections::HashSet::with_capacity(snapshot.rules.len());
        for rule in &snapshot.rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }

        snapshot.rules.sort_by_key(|r| {
            (
                r.priority,
                host_specificity(&r.origin),
                std::cmp::Reverse(r.path_prefix.len()),
                r.id.clone(),
            )
        });

        let mut rules = Vec::with_capacity(snapshot.rules.len());
        for rule in snapshot.rules {
            let origin_valid = if rule.origin == "*" {
                true
            } else if let Some(sub) = rule.origin.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                rule.origin
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };

            let blue_upstream = rule.blue_upstream.trim().to_string();
            let green_upstream = rule.green_upstream.trim().to_string();
            let is_valid_upstream = |u: &str| {
                !u.is_empty()
                    && u.len() <= 128
                    && u.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
            };

            if !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || !is_valid_upstream(&blue_upstream)
                || !is_valid_upstream(&green_upstream)
                || blue_upstream == green_upstream
                || rule.blue_upstream_headers.len() > 16
                || rule.green_upstream_headers.len() > 16
            {
                return Err(Error::InvalidPolicy);
            }

            let active_slot = if let Some(slot_str) = rule.active_slot.as_deref() {
                DeploySlot::from_str_ignore_case(slot_str).ok_or(Error::InvalidPolicy)?
            } else {
                DeploySlot::Blue
            };

            let is_valid_token_key = |k: &[u8]| {
                !k.is_empty()
                    && k.len() <= 64
                    && k.iter()
                        .all(|&b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
            };

            let switch_header = rule
                .switch_header
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty());

            if let Some(ref h) = switch_header
                && !is_valid_token_key(h.as_bytes())
            {
                return Err(Error::InvalidPolicy);
            }

            let preview_cookie = rule
                .preview_cookie
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase().into_bytes())
                .filter(|b| !b.is_empty());

            if let Some(ref c) = preview_cookie
                && !is_valid_token_key(c)
            {
                return Err(Error::InvalidPolicy);
            }

            let preview_query_param = rule
                .preview_query_param
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase().into_bytes())
                .filter(|b| !b.is_empty());

            if let Some(ref q) = preview_query_param
                && !is_valid_token_key(q)
            {
                return Err(Error::InvalidPolicy);
            }

            let secret_header = rule
                .preview_secret_header
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty());

            if let Some(ref sh) = secret_header
                && !is_valid_token_key(sh.as_bytes())
            {
                return Err(Error::InvalidPolicy);
            }

            let secret_hash = if let Some(ref sec) = rule.preview_secret {
                let trimmed_sec = sec.trim();
                if trimmed_sec.len() > 256
                    || trimmed_sec.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0)
                {
                    return Err(Error::InvalidPolicy);
                }
                if !trimmed_sec.is_empty() {
                    fnv1a_64(trimmed_sec.as_bytes())
                } else {
                    0
                }
            } else {
                0
            };

            let mut allowed_cidrs = Vec::with_capacity(rule.allowed_cidrs.len());
            if rule.allowed_cidrs.len() > 32 {
                return Err(Error::InvalidPolicy);
            }
            for cidr_str in &rule.allowed_cidrs {
                if let Some((net, mask, _prefix)) =
                    crate::ip_restriction::ip::parse_ipv4_cidr(cidr_str)
                {
                    allowed_cidrs.push((net, mask));
                } else {
                    return Err(Error::InvalidPolicy);
                }
            }

            let validate_headers =
                |hdrs: Vec<super::policy::UpstreamHeaderInput>| -> Result<Arc<[(String, String)]>, Error> {
                    let mut out = Vec::with_capacity(hdrs.len());
                    for h in hdrs {
                        let name = h.name.trim().to_string();
                        let value = h.value.trim().to_string();
                        if !is_valid_token_key(name.as_bytes())
                            || value.len() > 256
                            || value.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0)
                        {
                            return Err(Error::InvalidPolicy);
                        }
                        out.push((name, value));
                    }
                    Ok(Arc::from(out))
                };

            let blue_upstream_headers = validate_headers(rule.blue_upstream_headers)?;
            let green_upstream_headers = validate_headers(rule.green_upstream_headers)?;

            let slot_sheet = SlotSheet {
                upstreams: [
                    SlotUpstreamMeta {
                        upstream: blue_upstream,
                        slot_name: "blue",
                        headers: blue_upstream_headers,
                    },
                    SlotUpstreamMeta {
                        upstream: green_upstream,
                        slot_name: "green",
                        headers: green_upstream_headers,
                    },
                ],
            };

            let is_wildcard_origin = rule.origin == "*";
            let origin_bytes = rule.origin.into_bytes();
            let path_prefix_ends_with_slash = rule.path_prefix.ends_with('/');
            let path_prefix_bytes = rule.path_prefix.into_bytes();

            rules.push(CompiledBlueGreenRule {
                id: rule.id,
                is_wildcard_origin,
                origin_bytes,
                path_prefix_bytes,
                path_prefix_ends_with_slash,
                active_slot: active_slot.to_u8(),
                slot_sheet,
                switch_header,
                preview_cookie,
                preview_query_param,
                secret_header,
                secret_hash,
                allowed_cidrs,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    #[inline]
    pub fn evaluate_ctx<'a, 'h>(
        &'a self,
        ctx: &crate::AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> BlueGreenDecision<'a> {
        let req = BlueGreenEvalRequest {
            origin: ctx.host,
            path: ctx.path,
            client_ip: ctx.client_ip,
            query: ctx.query,
        };
        self.evaluate(&req, header_lookup)
    }

    pub fn evaluate<'a, 'h>(
        &'a self,
        req: &BlueGreenEvalRequest<'_>,
        header_lookup: impl Fn(&str) -> Option<&'h [u8]>,
    ) -> BlueGreenDecision<'a> {
        if req.origin.is_empty()
            || req.origin.len() > 253
            || req.path.is_empty()
            || req.path.len() > MAX_PATH_BYTES
            || !req.path.starts_with(b"/")
        {
            return BlueGreenDecision::unmatched();
        }

        for rule in &self.rules {
            if !rule.is_wildcard_origin && !host_matches(&rule.origin_bytes, req.origin) {
                continue;
            }
            if !path_matches(
                &rule.path_prefix_bytes,
                rule.path_prefix_ends_with_slash,
                req.path,
            ) {
                continue;
            }

            // Step 1: Zero-alloc SWAR Candidate Slot Resolution
            let mut has_override = 0u8;
            let mut candidate_slot = 0u8;

            // 1a. Header inspection
            if let Some(ref header_name) = rule.switch_header
                && let Some(val_bytes) = header_lookup(header_name)
                && let Some(slot) = parse_slot_swar(val_bytes)
            {
                has_override = 1;
                candidate_slot = slot;
            }

            // 1b. Cookie inspection (fallback if header absent)
            if has_override == 0
                && let Some(ref cookie_name) = rule.preview_cookie
                && let Some(cookie_hdr) = header_lookup("cookie")
                && let Some(val_bytes) = extract_cookie_value(cookie_hdr, cookie_name)
                && let Some(slot) = parse_slot_swar(val_bytes)
            {
                has_override = 1;
                candidate_slot = slot;
            }

            // 1c. Query parameter inspection (fallback if header and cookie absent)
            if has_override == 0
                && let Some(ref param_name) = rule.preview_query_param
                && let Some(val_bytes) = extract_query_value(req.query, param_name)
                && let Some(slot) = parse_slot_swar(val_bytes)
            {
                has_override = 1;
                candidate_slot = slot;
            }

            // Step 2: Arithmetic Security Guard (Preview Secret & CIDR Boundary)
            let mut secret_ok = 1u8;
            let mut cidr_ok = 1u8;

            if has_override == 1 {
                // 2a. Pre-shared Secret Key validation in 1 integer register comparison
                secret_ok = verify_preview_secret(
                    rule.secret_hash,
                    rule.secret_header.as_deref(),
                    req.query,
                    &header_lookup,
                );

                // 2b. CIDR Bitwise Boundary validation
                cidr_ok = verify_cidr_boundary(&rule.allowed_cidrs, req.client_ip);
            }

            // Step 3: Branchless Arithmetic Selection Formula
            let valid_override = has_override & secret_ok & cidr_ok;
            let chosen_slot = select_slot_branchless(valid_override, candidate_slot, rule.active_slot);

            let meta = &rule.slot_sheet.upstreams[chosen_slot as usize];
            let is_override = valid_override != 0;

            return BlueGreenDecision::matched(
                rule.id.as_str(),
                meta.upstream.as_str(),
                meta.slot_name,
                is_override,
                &meta.headers,
            );
        }

        BlueGreenDecision::unmatched()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_engine(json_str: &str) -> BlueGreenEngine {
        BlueGreenEngine::from_snapshot(json_str.as_bytes()).unwrap()
    }

    #[test]
    fn test_default_active_blue_slot() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "blue_upstream_headers": [{ "name": "x-slot", "value": "blue" }],
            "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
        }"#;
        let engine = test_engine(json);
        let req = BlueGreenEvalRequest::new(b"example.com", b"/api");
        let d = engine.evaluate(&req, |_| None);
        assert!(d.matched);
        assert_eq!(d.upstream, "app_blue");
        assert_eq!(d.active_slot, "blue");
        assert!(!d.is_header_override);
        assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "blue".to_string())]);
    }

    #[test]
    fn test_active_green_slot() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "green",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "green_upstream_headers": [{ "name": "x-slot", "value": "green" }]
        }"#;
        let engine = test_engine(json);
        let req = BlueGreenEvalRequest::new(b"example.com", b"/api");
        let d = engine.evaluate(&req, |_| None);
        assert!(d.matched);
        assert_eq!(d.upstream, "app_green");
        assert_eq!(d.active_slot, "green");
        assert!(!d.is_header_override);
        assert_eq!(d.upstream_headers, &[("x-slot".to_string(), "green".to_string())]);
    }

    #[test]
    fn test_switch_header_override() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "switch_header": "x-deploy-slot"
        }"#;
        let engine = test_engine(json);
        let req = BlueGreenEvalRequest::new(b"example.com", b"/dashboard");

        // Override to green (lowercase)
        let d_green = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
        assert!(d_green.matched);
        assert_eq!(d_green.upstream, "app_green");
        assert!(d_green.is_header_override);

        // Override to green (SWAR uppercase "GREEN")
        let d_green_upper = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"GREEN"));
        assert!(d_green_upper.matched);
        assert_eq!(d_green_upper.upstream, "app_green");
        assert!(d_green_upper.is_header_override);

        // Invalid value falls back to active blue
        let d_fallback = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"staging"));
        assert!(d_fallback.matched);
        assert_eq!(d_fallback.upstream, "app_blue");
        assert!(!d_fallback.is_header_override);
    }

    #[test]
    fn test_cookie_preview_override() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "preview_cookie": "deploy_slot"
        }"#;
        let engine = test_engine(json);
        let req = BlueGreenEvalRequest::new(b"example.com", b"/home");

        let d = engine.evaluate(&req, |k| {
            (k == "cookie").then_some(b"session=abc123; deploy_slot=green; tracking=xyz")
        });
        assert!(d.matched);
        assert_eq!(d.upstream, "app_green");
        assert!(d.is_header_override);
    }

    #[test]
    fn test_query_param_preview_override() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "preview_query_param": "deploy_slot"
        }"#;
        let engine = test_engine(json);
        let req_green = BlueGreenEvalRequest::with_details(
            b"example.com",
            b"/search",
            b"127.0.0.1",
            b"q=rust&deploy_slot=green&page=1",
        );
        let d = engine.evaluate(&req_green, |_| None);
        assert!(d.matched);
        assert_eq!(d.upstream, "app_green");
        assert!(d.is_header_override);
    }

    #[test]
    fn test_preview_secret_security_guard() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "switch_header": "x-deploy-slot",
            "preview_secret": "stage-secret-2026",
            "preview_secret_header": "x-preview-secret"
        }"#;
        let engine = test_engine(json);
        let req = BlueGreenEvalRequest::new(b"example.com", b"/api");

        // Attacker without secret -> Fallback to blue
        let d_forged = engine.evaluate(&req, |k| (k == "x-deploy-slot").then_some(b"green"));
        assert_eq!(d_forged.upstream, "app_blue");
        assert!(!d_forged.is_header_override);

        // Attacker with wrong secret -> Fallback to blue
        let d_wrong = engine.evaluate(&req, |k| match k {
            "x-deploy-slot" => Some(b"green"),
            "x-preview-secret" => Some(b"wrong-key"),
            _ => None,
        });
        assert_eq!(d_wrong.upstream, "app_blue");
        assert!(!d_wrong.is_header_override);

        // Authorized with valid secret -> Routed to green
        let d_auth = engine.evaluate(&req, |k| match k {
            "x-deploy-slot" => Some(b"green"),
            "x-preview-secret" => Some(b"stage-secret-2026"),
            _ => None,
        });
        assert_eq!(d_auth.upstream, "app_green");
        assert!(d_auth.is_header_override);
    }

    #[test]
    fn test_preview_cidr_and_secret_combined() {
        let json = r#"{
            "schema_version": 1, "generation": 1, "active_slot": "blue",
            "blue_upstream": "app_blue", "green_upstream": "app_green",
            "switch_header": "x-deploy-slot",
            "preview_secret": "top-secret-key",
            "allowed_cidrs": ["10.0.0.0/8"]
        }"#;
        let engine = test_engine(json);

        // Valid secret but external IP (8.8.8.8) -> Fallback to blue
        let req_ext = BlueGreenEvalRequest::with_details(b"example.com", b"/", b"8.8.8.8", b"");
        let d1 = engine.evaluate(&req_ext, |k| match k {
            "x-deploy-slot" => Some(b"green"),
            "x-preview-secret" => Some(b"top-secret-key"),
            _ => None,
        });
        assert_eq!(d1.upstream, "app_blue");

        // Valid secret and internal IP (10.1.2.3) -> ALLOWED Green!
        let req_int = BlueGreenEvalRequest::with_details(b"example.com", b"/", b"10.1.2.3", b"");
        let d2 = engine.evaluate(&req_int, |k| match k {
            "x-deploy-slot" => Some(b"green"),
            "x-preview-secret" => Some(b"top-secret-key"),
            _ => None,
        });
        assert_eq!(d2.upstream, "app_green");
        assert!(d2.is_header_override);
    }
}
