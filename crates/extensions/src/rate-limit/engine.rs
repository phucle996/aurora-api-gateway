//! Core In-Process Rate Limiting Engine (Slot 2).
//!
//! Orchestrates the high-performance rate limiting pipeline:
//! Radix tree route matching -> SWAR partition hash -> Fixed-point atomic counter
//! -> Single-pass zero-allocation 429 response renderer
//! -> Asynchronous Dual-Trigger Batch Sync with Redis.

use super::algorithm::build_exceeded_decision;
use super::policy::{
    ActionOnExceeded, CompiledHeader, CompiledRule, LimitBy, MAX_RATE_LIMIT_POLICY_BYTES,
    NUM_SHARDS, OnErrorAction, RateLimitDecision, RateLimitMode, RateLimitPolicy, ResolvedHeader,
};
use super::redis::RedisRateLimiter;
use super::shard::{Shard, ShardConfig, hash_key, insert_shard_entry};
use crate::radix::PathRadixTree;
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::sync::Notify;

pub(crate) struct IndexedRule {
    pub(crate) idx: usize,
    pub(crate) rule: CompiledRule,
}

#[repr(align(64))]
pub struct CacheAligned<T>(pub T);

/// Active in-memory Rate Limiting Engine.
pub struct RateLimitEngine {
    generation: u64,
    mode: RateLimitMode,
    shard_cfg: ShardConfig,
    rules: PathRadixTree<IndexedRule>,
    pub(crate) shards: Arc<Vec<CacheAligned<Mutex<Shard>>>>,
    redis: Option<RedisRateLimiter>,
    early_flush_notify: Arc<Notify>,
    is_async_batch_sync: bool,
}

#[inline]
fn now_epoch_secs_and_ms() -> (u64, u64) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs(), now.as_millis() as u64)
}

/// Single-pass $O(N)$ template renderer. Replaces variables with zero intermediate allocations.
fn render_template_single_pass(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len().saturating_add(64));
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'$' {
            let rest = &template[i..];
            let mut matched = false;
            for &(var, val) in vars {
                if rest.starts_with(var) {
                    out.push_str(val);
                    i += var.len();
                    matched = true;
                    break;
                }
            }
            if !matched {
                out.push('$');
                i += 1;
            }
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
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

    // 1. Render custom response headers in single pass
    if !rule.response_headers.is_empty() {
        let mut headers = Vec::with_capacity(rule.response_headers.len());
        for h in &rule.response_headers {
            let rendered_name = render_template_single_pass(&h.name, &vars);
            let rendered_value = render_template_single_pass(&h.value, &vars);
            headers.push(ResolvedHeader {
                name: rendered_name,
                value: rendered_value,
            });
        }
        decision.headers = headers;
    }

    // 2. Render custom response body in single pass
    if let Some(ref msg) = rule.custom_message {
        let rendered_body = render_template_single_pass(msg, &vars);
        decision.body = Some(rendered_body.into_bytes());
    }
}

impl RateLimitEngine {
    /// Deserializes, validates, and initializes RateLimitEngine from raw JSON bytes.
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_RATE_LIMIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let policy: RateLimitPolicy =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        policy.validate().map_err(|_| Error::InvalidPolicy)?;
        Self::from_policy(&policy)
    }

    /// Compiles an active `RateLimitEngine` from a validated `RateLimitPolicy`.
    pub fn from_policy(policy: &RateLimitPolicy) -> Result<Self, Error> {
        let total_max_keys = policy.max_keys;
        let max_keys_per_shard = total_max_keys / NUM_SHARDS;
        if max_keys_per_shard == 0 {
            return Err(Error::InvalidPolicy);
        }

        let threshold_percent = policy
            .redis
            .as_ref()
            .map(|r| r.threshold_percent)
            .unwrap_or(20);
        let min_delta = policy
            .redis
            .as_ref()
            .map(|r| r.min_delta_threshold)
            .unwrap_or(5);
        let max_delta = policy
            .redis
            .as_ref()
            .map(|r| r.max_delta_threshold)
            .unwrap_or(100);

        let mut sorted_rules = policy.rules.clone();
        sorted_rules.sort_by_key(|r| (r.priority, host_specificity(&r.host), r.id.clone()));

        let mut compiled_rules = Vec::with_capacity(sorted_rules.len());
        for rule in sorted_rules {
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

            let response_headers = match rule.response_headers {
                Some(headers) => {
                    let mut compiled = Vec::with_capacity(headers.len());
                    for h in headers {
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
                    (LimitBy::Header, Some(h_name))
                }
                _ => return Err(Error::InvalidPolicy),
            };

            let burst = match rule.burst {
                Some(b) => b,
                None => rule.rate,
            };

            let calc_delta = ((rule.rate * threshold_percent as u64) / 100) as u32;
            let emergency_delta_threshold = calc_delta.clamp(min_delta, max_delta);

            compiled_rules.push(CompiledRule {
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
                emergency_delta_threshold,
            });
        }

        let mut shards = Vec::with_capacity(NUM_SHARDS);
        for _ in 0..NUM_SHARDS {
            shards.push(CacheAligned(Mutex::new(Shard::new())));
        }
        let shards = Arc::new(shards);
        let early_flush_notify = Arc::new(Notify::new());

        let redis = if policy.mode == RateLimitMode::Distributed {
            let redis_cfg = policy.redis.as_ref().ok_or(Error::InvalidPolicy)?;
            Some(RedisRateLimiter::new(redis_cfg, policy.algorithm)?)
        } else {
            None
        };

        let sync_interval_ms = policy
            .redis
            .as_ref()
            .map(|r| r.sync_interval_ms)
            .unwrap_or(0);
        let is_async_batch_sync = policy.mode == RateLimitMode::Distributed && sync_interval_ms > 0;

        // Dispatch background shadow sync worker if async batch sync is active
        if is_async_batch_sync && let Some(ref r) = redis {
            let shards_clone = Arc::clone(&shards);
            let pool_clone = Arc::clone(&r.pool);
            let notify_clone = Arc::clone(&early_flush_notify);
            let sync_interval = std::time::Duration::from_millis(sync_interval_ms);

            let _ = aurora_engine::shadow::try_dispatch_shadow(Box::pin(async move {
                super::redis_sync::run_rate_limit_redis_shadow_sync(
                    shards_clone,
                    pool_clone,
                    notify_clone,
                    sync_interval,
                )
                .await;
            }));
        }

        let mut rules_tree = PathRadixTree::new();
        for (idx, rule) in compiled_rules.into_iter().enumerate() {
            rules_tree.insert(&rule.path_prefix.clone(), IndexedRule { idx, rule });
        }

        Ok(Self {
            generation: policy.generation,
            mode: policy.mode,
            shard_cfg: ShardConfig {
                max_keys_per_shard,
                eviction_policy: policy.eviction_policy,
                overflow_strategy: policy.overflow_strategy,
                algorithm: policy.algorithm,
            },
            rules: rules_tree,
            shards,
            redis,
            early_flush_notify,
            is_async_batch_sync,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline]
    pub fn evaluate_ctx<'a, 'h>(
        &self,
        ctx: &crate::AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<RateLimitDecision, Error> {
        self.evaluate(ctx.host, ctx.path, ctx.client_ip, header_lookup)
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
        let mut blocked_decision = None;
        let mut eval_err = None;

        self.rules.for_each_match(path, |item| {
            if eval_err.is_some() || blocked_decision.is_some() {
                return;
            }

            let idx = item.idx;
            let rule = &item.rule;

            if !host_matches(&rule.host, host) {
                return;
            }

            matched_any = true;
            let identifier: &[u8] = match &rule.limit_by {
                LimitBy::ClientIp => client_ip,
                LimitBy::RoutePath => path,
                LimitBy::Header => {
                    let h_name = match rule.header_name.as_deref().ok_or(Error::InvalidRequest) {
                        Ok(h) => h,
                        Err(e) => {
                            eval_err = Some(e);
                            return;
                        }
                    };
                    match header_lookup(h_name) {
                        Some(v) if !v.is_empty() => v,
                        _ => {
                            eval_err = Some(Error::InvalidRequest);
                            return;
                        }
                    }
                }
            };

            let mut decision = if self.mode == RateLimitMode::Distributed {
                if self.is_async_batch_sync {
                    self.evaluate_rule_shard(idx, rule, identifier, now_secs, now_ms)
                } else if let Some(ref r) = self.redis {
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
                blocked_decision = Some(decision);
                return;
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
        });

        if let Some(err) = eval_err {
            return Err(err);
        }
        if let Some(decision) = blocked_decision {
            return Ok(decision);
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
        let mut shard = self.shards[shard_idx]
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner());

        let map_key = super::shard::RateLimitKeyRef(rule_idx, identifier);

        // A wall-clock rollback must not invalidate the shard's TTL bound.
        shard.oldest_access_lower_bound = shard.oldest_access_lower_bound.min(now_secs);

        // Existing counters need only one borrowed lookup and no owned key.
        if let Some(entry) = shard.entries.get_mut(&map_key) {
            entry.last_access_secs = now_secs;
            entry.access_count += 1;

            if self.mode == RateLimitMode::Distributed
                && entry.cluster_blocked.load(Ordering::Relaxed)
            {
                let retry_after = rule.period_secs.max(1) as u32;
                return build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64);
            }

            let decision = entry.state.advance(rule, now_secs, now_ms);
            if self.mode == RateLimitMode::Distributed && decision.allowed {
                let delta = entry.pending_delta.fetch_add(1, Ordering::Relaxed) + 1;
                if delta >= rule.emergency_delta_threshold {
                    self.early_flush_notify.notify_one();
                }
            }
            return decision;
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

        if self.mode == RateLimitMode::Distributed && entry.cluster_blocked.load(Ordering::Relaxed)
        {
            let retry_after = rule.period_secs.max(1) as u32;
            return build_exceeded_decision(rule, retry_after, now_secs + retry_after as u64);
        }

        let decision = entry.state.advance(rule, now_secs, now_ms);
        if self.mode == RateLimitMode::Distributed && decision.allowed {
            let delta = entry.pending_delta.fetch_add(1, Ordering::Relaxed) + 1;
            if delta >= rule.emergency_delta_threshold {
                self.early_flush_notify.notify_one();
            }
        }
        decision
    }
}
