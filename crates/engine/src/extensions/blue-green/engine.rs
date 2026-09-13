use super::types::{
    BlueGreenDecision, BlueGreenEvalRequest, BlueGreenRuleInput, BlueGreenSnapshot,
    CompiledBlueGreenRule, DeploySlot, MAX_BLUE_GREEN_POLICY_BYTES, MAX_BLUE_GREEN_RULES,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

#[derive(Debug)]
pub struct BlueGreenEngine {
    generation: u64,
    rules: Vec<CompiledBlueGreenRule>,
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
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

            if !origin_valid
                || rule.origin.is_empty()
                || rule.origin.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
                || rule.blue_upstream.trim().is_empty()
                || rule.blue_upstream.len() > 128
                || rule.green_upstream.trim().is_empty()
                || rule.green_upstream.len() > 128
                || rule.blue_upstream == rule.green_upstream
            {
                return Err(Error::InvalidPolicy);
            }

            let active_slot = if let Some(slot_str) = rule.active_slot.as_deref() {
                DeploySlot::from_str_ignore_case(slot_str).ok_or(Error::InvalidPolicy)?
            } else {
                DeploySlot::Blue
            };

            let switch_header = rule
                .switch_header
                .as_ref()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty());

            if let Some(ref h) = switch_header {
                if h.len() > 64
                    || !h
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(Error::InvalidPolicy);
                }
            }

            let blue_upstream_headers = rule
                .blue_upstream_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();

            let green_upstream_headers = rule
                .green_upstream_headers
                .into_iter()
                .map(|h| (h.name, h.value))
                .collect();

            rules.push(CompiledBlueGreenRule {
                id: rule.id,
                origin: rule.origin,
                path_prefix: rule.path_prefix,
                active_slot,
                blue_upstream: rule.blue_upstream,
                green_upstream: rule.green_upstream,
                switch_header,
                blue_upstream_headers,
                green_upstream_headers,
            });
        }

        Ok(Self {
            generation: snapshot.generation,
            rules,
        })
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
            if !host_matches(rule.origin.as_bytes(), req.origin) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), req.path) {
                continue;
            }

            // Check switch header override
            if let Some(ref header_name) = rule.switch_header {
                if let Some(val_bytes) = header_lookup(header_name) {
                    if let Ok(val_str) = std::str::from_utf8(val_bytes) {
                        if let Some(override_slot) = DeploySlot::from_str_ignore_case(val_str) {
                            return match override_slot {
                                DeploySlot::Blue => BlueGreenDecision::matched(
                                    rule.id.as_str(),
                                    rule.blue_upstream.as_str(),
                                    "blue",
                                    true,
                                    &rule.blue_upstream_headers,
                                ),
                                DeploySlot::Green => BlueGreenDecision::matched(
                                    rule.id.as_str(),
                                    rule.green_upstream.as_str(),
                                    "green",
                                    true,
                                    &rule.green_upstream_headers,
                                ),
                            };
                        }
                    }
                }
            }

            // Default to active slot
            return match rule.active_slot {
                DeploySlot::Blue => BlueGreenDecision::matched(
                    rule.id.as_str(),
                    rule.blue_upstream.as_str(),
                    "blue",
                    false,
                    &rule.blue_upstream_headers,
                ),
                DeploySlot::Green => BlueGreenDecision::matched(
                    rule.id.as_str(),
                    rule.green_upstream.as_str(),
                    "green",
                    false,
                    &rule.green_upstream_headers,
                ),
            };
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
