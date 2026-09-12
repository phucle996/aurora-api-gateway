use super::types::{
    CompiledRule, LimitBy, MAX_REQUEST_SIZE_POLICY_BYTES, MAX_REQUEST_SIZE_RULES,
    RequestSizeDecision, RequestSizeEvalRequest, RequestSizeSnapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use regex::Regex;

pub struct RequestSizeLimitEngine {
    generation: u64,
    rules: Vec<CompiledRule>,
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

impl RequestSizeLimitEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_REQUEST_SIZE_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: RequestSizeSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > MAX_REQUEST_SIZE_RULES {
            return Err(Error::InvalidPolicy);
        }

        let mut ids = std::collections::HashSet::with_capacity(snapshot.rules.len());
        for rule in &snapshot.rules {
            if rule.id.trim().is_empty() || rule.id.len() > 128 || !ids.insert(rule.id.clone()) {
                return Err(Error::InvalidPolicy);
            }
        }

        snapshot
            .rules
            .sort_by_key(|r| (r.priority, host_specificity(&r.origin), r.id.clone()));

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

            if rule.max_request_bytes == 0
                || rule.max_request_bytes > 10_737_418_240
                || rule.max_header_bytes > 10_485_760
                || rule.max_body_bytes > 10_737_418_240
                || !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || !(400..=599).contains(&rule.rejected_code)
                || rule.response_body.len() > 4096
                || rule.match_value.len() > 256
            {
                return Err(Error::InvalidPolicy);
            }

            let (limit_by, header_name) = match rule.limit_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => (LimitBy::ClientIp, None),
                "route_path" => (LimitBy::RoutePath, None),
                "header" => {
                    let h_name = rule
                        .header_name
                        .as_ref()
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                        .ok_or(Error::InvalidPolicy)?;
                    if h_name.len() > 64
                        || !h_name
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                    {
                        return Err(Error::InvalidPolicy);
                    }
                    (LimitBy::Header, Some(h_name))
                }
                _ => return Err(Error::InvalidPolicy),
            };

            let is_wildcard = rule.match_value == "*" || rule.match_value.is_empty();
            let regex = if !is_wildcard {
                Some(Regex::new(&rule.match_value).map_err(|_| Error::InvalidPolicy)?)
            } else {
                None
            };

            rules.push(CompiledRule {
                id: rule.id,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                limit_by,
                header_name,
                is_wildcard,
                regex,
                max_request_bytes: rule.max_request_bytes,
                max_header_bytes: rule.max_header_bytes,
                max_body_bytes: rule.max_body_bytes,
                rejected_code: rule.rejected_code,
                response_body: rule.response_body.into_bytes(),
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
    }

    pub fn evaluate<'a>(
        &self,
        req: &RequestSizeEvalRequest<'a>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> RequestSizeDecision {
        if req.origin.is_empty()
            || req.origin.len() > 253
            || req.path.is_empty()
            || req.path.len() > MAX_PATH_BYTES
            || !req.path.starts_with(b"/")
            || req.client_ip.is_empty()
            || req.client_ip.len() > 64
        {
            return RequestSizeDecision::allow();
        }

        for rule in &self.rules {
            if !host_matches(rule.origin.as_bytes(), req.origin) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

            let dimension_matches = match rule.limit_by {
                LimitBy::ClientIp => {
                    if rule.is_wildcard {
                        true
                    } else if let Some(re) = &rule.regex
                        && let Ok(ip_str) = std::str::from_utf8(req.client_ip)
                    {
                        re.is_match(ip_str)
                    } else {
                        false
                    }
                }
                LimitBy::RoutePath => {
                    if rule.is_wildcard {
                        true
                    } else if let Some(re) = &rule.regex
                        && let Ok(path_str) = std::str::from_utf8(req.path)
                    {
                        re.is_match(path_str)
                    } else {
                        false
                    }
                }
                LimitBy::Header => {
                    if let Some(ref h_name) = rule.header_name
                        && let Some(val) = header_lookup(h_name)
                    {
                        if rule.is_wildcard {
                            !val.is_empty()
                        } else if let Some(re) = &rule.regex
                            && let Ok(val_str) = std::str::from_utf8(val)
                        {
                            re.is_match(val_str)
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                }
            };

            if !dimension_matches {
                continue;
            }

            // Rule matched! Inspect total bytes, header bytes, and body bytes:
            let total_bytes = req.header_bytes.saturating_add(req.body_bytes);

            let violates_total = rule.max_request_bytes > 0 && total_bytes > rule.max_request_bytes;
            let violates_header =
                rule.max_header_bytes > 0 && req.header_bytes > rule.max_header_bytes;
            let violates_body = rule.max_body_bytes > 0 && req.body_bytes > rule.max_body_bytes;

            if violates_total || violates_header || violates_body {
                return RequestSizeDecision::reject(
                    rule.id.clone(),
                    rule.rejected_code,
                    rule.response_body.clone(),
                );
            }

            return RequestSizeDecision::allow_matched(rule.id.clone());
        }

        RequestSizeDecision::allow()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn rules_count(&self) -> usize {
        self.rules.len()
    }
}
