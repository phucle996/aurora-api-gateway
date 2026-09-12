use crate::extensions::rate_limit::shard::{
    Shard, ShardConfig, ensure_shard_capacity_and_entry, hash_key,
};
use crate::extensions::rate_limit::types::{
    ActionOnExceeded, CompiledRule, LimitBy, MAX_RATE_LIMIT_POLICY_BYTES, MAX_RATE_LIMIT_RULES,
    NUM_SHARDS, RateLimitDecision, Snapshot,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use std::sync::Mutex;
use std::time::SystemTime;

pub struct RateLimitEngine {
    generation: u64,
    shard_cfg: ShardConfig,
    rules: Vec<CompiledRule>,
    shards: Vec<Mutex<Shard>>,
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
                .is_some_and(|msg| msg.len() > 1024)
            {
                return Err(Error::InvalidPolicy);
            }

            let limit_by = match rule.limit_by.trim().to_ascii_lowercase().as_str() {
                "client_ip" => LimitBy::ClientIp,
                "api_key" => LimitBy::ApiKey,
                "authorization" => LimitBy::Authorization,
                "route_path" => LimitBy::RoutePath,
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
                rate: rule.rate,
                period_secs: rule.period_secs,
                burst,
                action_on_exceeded: rule.action_on_exceeded,
                rejected_code,
                custom_message: rule.custom_message,
            });
        }

        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(Mutex::new(Shard::new()));
        }

        Ok(Self {
            generation: snapshot.generation,
            shard_cfg: ShardConfig {
                max_keys_per_shard,
                eviction_policy: snapshot.eviction_policy,
                overflow_strategy: snapshot.overflow_strategy,
                algorithm: snapshot.algorithm,
            },
            rules,
            shards,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate(
        &self,
        host: &[u8],
        path: &[u8],
        client_ip: &[u8],
        api_key: Option<&[u8]>,
        authorization: Option<&[u8]>,
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
                LimitBy::ApiKey => match api_key {
                    Some(k) if !k.is_empty() => k,
                    _ => return Err(Error::InvalidRequest),
                },
                LimitBy::Authorization => match authorization {
                    Some(a) if !a.is_empty() => a,
                    _ => return Err(Error::InvalidRequest),
                },
            };

            let decision = self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms);
            if !decision.allowed {
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
            return Ok(RateLimitDecision {
                allowed: true,
                action: ActionOnExceeded::Throttle,
                status_code: 200,
                retry_after_secs: 0,
                remaining: u32::MAX,
                reset_epoch_secs: 0,
            });
        }

        Ok(RateLimitDecision {
            allowed: true,
            action: ActionOnExceeded::Throttle,
            status_code: 200,
            retry_after_secs: 0,
            remaining: min_remaining,
            reset_epoch_secs: max_reset_epoch,
        })
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

        let map_key = (rule_idx, identifier.to_vec());

        let entry = match ensure_shard_capacity_and_entry(
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
