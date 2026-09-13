use crate::extensions::rate_limit::redis::RedisRateLimiter;
use crate::extensions::rate_limit::shard::{Shard, ShardConfig, hash_key, insert_shard_entry};
use crate::extensions::rate_limit::types::{
    ActionOnExceeded, CompiledHeader, CompiledRule, LimitBy, MAX_RATE_LIMIT_POLICY_BYTES,
    MAX_RATE_LIMIT_RULES, NUM_SHARDS, OnErrorAction, RateLimitDecision, RateLimitMode,
    ResolvedHeader, Snapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use std::sync::Mutex;
use std::time::SystemTime;

pub struct RateLimitEngine {
    generation: u64,
    mode: RateLimitMode,
    shard_cfg: ShardConfig,
    rules: Vec<CompiledRule>,
    shards: Vec<Mutex<Shard>>,
    redis: Option<RedisRateLimiter>,
}

fn now_epoch_secs_and_ms() -> (u64, u64) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs(), now.as_millis() as u64)
}

fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    path.starts_with(prefix)
        && (prefix.ends_with(b"/")
            || path.len() == prefix.len()
            || path.get(prefix.len()) == Some(&b'/'))
}

fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut result = template.to_string();
    for &(var, val) in vars {
        result = result.replace(var, val);
    }
    result
}

fn apply_custom_response(decision: &mut RateLimitDecision, rule: &CompiledRule) {
    let retry_after_str = decision.retry_after_secs.to_string();
    let remaining_str = decision.remaining.to_string();
    let reset_epoch_str = decision.reset_epoch_secs.to_string();
    let limit_str = rule.burst.to_string();
    let rate_str = rule.rate.to_string();
    let burst_str = rule.burst.to_string();
    let status_code_str = decision.status_code.to_string();
    let empty_str = String::new();
    let custom_reason_str = decision.custom_reason.as_deref().unwrap_or(&empty_str);

    let vars: [(&str, &str); 16] = [
        ("${retry_after}", &retry_after_str),
        ("$retry_after", &retry_after_str),
        ("${remaining}", &remaining_str),
        ("$remaining", &remaining_str),
        ("${reset_epoch}", &reset_epoch_str),
        ("$reset_epoch", &reset_epoch_str),
        ("${limit}", &limit_str),
        ("$limit", &limit_str),
        ("${rate}", &rate_str),
        ("$rate", &rate_str),
        ("${burst}", &burst_str),
        ("$burst", &burst_str),
        ("${status_code}", &status_code_str),
        ("$status_code", &status_code_str),
        ("${custom_reason}", custom_reason_str),
        ("$custom_reason", custom_reason_str),
    ];

    // 1. Render custom response headers
    if !rule.response_headers.is_empty() {
        let mut headers = Vec::with_capacity(rule.response_headers.len());
        for h in &rule.response_headers {
            let rendered_name = render_template(&h.name, &vars);
            let rendered_value = render_template(&h.value, &vars);
            if !rendered_name.is_empty() {
                headers.push(ResolvedHeader {
                    name: rendered_name,
                    value: rendered_value,
                });
            }
        }
        decision.headers = headers;
    }

    // 2. Render custom message body
    if let Some(ref msg_tmpl) = rule.custom_message {
        let rendered_body = render_template(msg_tmpl, &vars);
        decision.body = Some(rendered_body.into_bytes());
    } else if let Some(reason) = decision.custom_reason.as_deref().filter(|s| !s.is_empty()) {
        decision.body = Some(reason.as_bytes().to_vec());
    }
}

impl RateLimitEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_RATE_LIMIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let mut snapshot: Snapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        if snapshot.schema_version != 1
            || snapshot.generation == 0
            || snapshot.generation > i64::MAX as u64
            || snapshot.rules.is_empty()
            || snapshot.rules.len() > MAX_RATE_LIMIT_RULES
        {
            return Err(Error::InvalidPolicy);
        }

        // Memory budget bounds: strictly enforce without clamping or silent shrinking
        if snapshot.memory_size_mb == 0
            || snapshot.memory_size_mb > 1024
            || snapshot.max_keys < 16
            || snapshot.max_keys > 5_000_000
        {
            return Err(Error::InvalidPolicy);
        }

        let mb_keys = (snapshot.memory_size_mb as usize * 1024 * 1024) / 128;
        if snapshot.max_keys > mb_keys {
            return Err(Error::InvalidPolicy);
        }

        let total_max_keys = snapshot.max_keys;
        let max_keys_per_shard = total_max_keys / NUM_SHARDS;
        if max_keys_per_shard == 0 {
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
            .sort_by_key(|r| (r.priority, host_specificity(&r.host), r.id.clone()));

        let mut rules = Vec::with_capacity(snapshot.rules.len());
        for rule in snapshot.rules {
            let host_valid = if rule.host == "*" {
                true
            } else if let Some(sub) = rule.host.strip_prefix("*.") {
                !sub.is_empty()
                    && sub
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            } else {
                rule.host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            };

            let rejected_code = match rule.rejected_code {
                Some(code) if (200..=599).contains(&code) => code,
                Some(_) => return Err(Error::InvalidPolicy),
                None => match rule.action_on_exceeded {
                    ActionOnExceeded::Throttle => 429,
                    ActionOnExceeded::Block => 403,
                    ActionOnExceeded::Audit => 200,
                    ActionOnExceeded::CustomResponse => 429,
                },
            };

            if rule.rate == 0
                || rule.period_secs == 0
                || rule.period_secs > 86400
                || !host_valid
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule.path_prefix.bytes().any(|b| b <= 32 || b >= 127)
            {
                return Err(Error::InvalidPolicy);
            }

            if rule
                .custom_message
                .as_deref()
                .is_some_and(|msg| msg.len() > 2048)
            {
                return Err(Error::InvalidPolicy);
            }

            let response_headers = match rule.response_headers {
                Some(headers) => {
                    if headers.len() > 8 {
                        return Err(Error::InvalidPolicy);
                    }
                    let mut compiled = Vec::with_capacity(headers.len());
                    for h in headers {
                        if h.name.trim().is_empty() || h.name.len() > 64 || h.value.len() > 256 {
                            return Err(Error::InvalidPolicy);
                        }
                        compiled.push(CompiledHeader {
                            name: h.name,
                            value: h.value,
                        });
                    }
                    compiled
                }
                None => Vec::new(),
            };

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

            let burst = match rule.burst {
                Some(0) => return Err(Error::InvalidPolicy),
                Some(b) if b < rule.rate => return Err(Error::InvalidPolicy),
                Some(b) => b,
                None => rule.rate,
            };

            rules.push(CompiledRule {
                id: rule.id,
                host: rule.host.into_bytes(),
                path_prefix: rule.path_prefix.into_bytes(),
                limit_by,
                header_name,
                rate: rule.rate,
                period_secs: rule.period_secs,
                burst,
                action_on_exceeded: rule.action_on_exceeded,
                rejected_code,
                custom_message: rule.custom_message,
                response_headers,
            });
        }

        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(Mutex::new(Shard::new()));
        }

        let redis = if snapshot.mode == RateLimitMode::Distributed {
            let redis_cfg = snapshot.redis.as_ref().ok_or(Error::InvalidPolicy)?;
            Some(RedisRateLimiter::new(redis_cfg, snapshot.algorithm)?)
        } else {
            None
        };

        Ok(Self {
            generation: snapshot.generation,
            mode: snapshot.mode,
            shard_cfg: ShardConfig {
                max_keys_per_shard,
                eviction_policy: snapshot.eviction_policy,
                overflow_strategy: snapshot.overflow_strategy,
                algorithm: snapshot.algorithm,
            },
            rules,
            shards,
            redis,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate<'a>(
        &self,
        host: &[u8],
        path: &[u8],
        client_ip: &[u8],
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<RateLimitDecision, Error> {
        if host.len() > 253
            || host.contains(&0)
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || path[0] != b'/'
            || path.contains(&0)
            || client_ip.is_empty()
            || client_ip.len() > 64
            || client_ip.contains(&0)
        {
            return Err(Error::InvalidRequest);
        }

        let (now_secs, now_ms) = now_epoch_secs_and_ms();

        let mut matched_any = false;
        let mut min_remaining = u32::MAX;
        let mut max_reset_epoch = 0;
        let mut audit_decision = None;

        for (idx, rule) in self.rules.iter().enumerate() {
            if !host_matches(&rule.host, host) || !path_matches(&rule.path_prefix, path) {
                continue;
            }

            matched_any = true;
            let identifier: &[u8] = match &rule.limit_by {
                LimitBy::ClientIp => client_ip,
                LimitBy::RoutePath => path,
                LimitBy::Header => {
                    let h_name = rule.header_name.as_deref().ok_or(Error::InvalidRequest)?;
                    match header_lookup(h_name) {
                        Some(v) if !v.is_empty() => v,
                        _ => return Err(Error::InvalidRequest),
                    }
                }
            };

            let mut decision = if self.mode == RateLimitMode::Distributed {
                if let Some(ref r) = self.redis {
                    match r.evaluate(idx, rule, identifier, now_ms) {
                        Ok(d) => d,
                        Err(()) => match r.on_error {
                            OnErrorAction::FallbackLocal => {
                                self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms)
                            }
                            OnErrorAction::Pass => RateLimitDecision::allow(u32::MAX, 0),
                            OnErrorAction::Block => RateLimitDecision {
                                allowed: false,
                                action: rule.action_on_exceeded,
                                status_code: rule.rejected_code,
                                retry_after_secs: 1,
                                remaining: 0,
                                reset_epoch_secs: now_secs + 1,
                                custom_reason: None,
                                headers: Vec::new(),
                                body: None,
                            },
                        },
                    }
                } else {
                    self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms)
                }
            } else {
                self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms)
            };
            if !decision.allowed {
                apply_custom_response(&mut decision, rule);
                return Ok(decision);
            }
            if decision.remaining < min_remaining {
                min_remaining = decision.remaining;
            }
            if decision.reset_epoch_secs > max_reset_epoch {
                max_reset_epoch = decision.reset_epoch_secs;
            }
            if decision.action == ActionOnExceeded::Audit {
                audit_decision = Some(decision);
            }
        }

        if let Some(mut audit) = audit_decision {
            audit.remaining = min_remaining;
            audit.reset_epoch_secs = max_reset_epoch;
            return Ok(audit);
        }

        if !matched_any {
            return Ok(RateLimitDecision::allow(u32::MAX, 0));
        }

        Ok(RateLimitDecision::allow(min_remaining, max_reset_epoch))
    }

    fn evaluate_rule_shard(
        &self,
        rule_idx: usize,
        rule: &CompiledRule,
        identifier: &[u8],
        now_secs: u64,
        now_ms: u64,
    ) -> RateLimitDecision {
        let shard_idx = hash_key(rule_idx, identifier);
        let mut shard = self.shards[shard_idx].lock().unwrap();

        let map_key = super::shard::RateLimitKeyRef(rule_idx, identifier);

        // A wall-clock rollback must not invalidate the shard's TTL bound.
        shard.oldest_access_lower_bound = shard.oldest_access_lower_bound.min(now_secs);

        // Existing counters need only one borrowed lookup and no owned key.
        if let Some(entry) = shard.entries.get_mut(&map_key) {
            entry.last_access_secs = now_secs;
            entry.access_count += 1;
            return entry.state.advance(rule, now_secs, now_ms);
        }

        let entry = match insert_shard_entry(
            &mut shard,
            &map_key,
            rule,
            &self.shard_cfg,
            now_secs,
            now_ms,
        ) {
            Ok(e) => e,
            Err(decision) => return decision,
        };

        entry.last_access_secs = now_secs;
        entry.access_count += 1;
        entry.state.advance(rule, now_secs, now_ms)
    }
}
