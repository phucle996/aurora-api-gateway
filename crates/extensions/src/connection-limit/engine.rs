//! Connection Limit Evaluation Engine (Slot 3)
//!
//! Provides high-performance, sharded concurrent connection tracking and rate throttling
//! with zero-allocation local tracking and fallback-tolerant distributed Redis L2 coordination.

use super::policy::{
    ActionOnExceeded, ConnLimitDecision, ConnLimitMode, ConnLimitToken, ConnectionLimitPolicy,
    LimitBy, MAX_CONN_LIMIT_POLICY_BYTES, OnErrorAction, ResolvedHeader,
};
use super::redis::RedisConnectionLimiter;
use super::tracker::ShardedConnTracker;
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};
use std::sync::Arc;

#[derive(Clone, Debug)]
pub(crate) struct CompiledHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug)]
pub(crate) struct CompiledRule {
    pub id: String,
    pub id_hash_prefix: u64,
    pub host: String,
    pub path_prefix: String,
    pub is_wildcard_host: bool,
    pub is_root_path: bool,
    pub is_pure: bool,
    pub limit_by: LimitBy,
    pub header_name: Option<String>,
    pub max_connections: u32,
    pub action_on_exceeded: ActionOnExceeded,
    pub rejected_code: u16,
    pub response_headers: Vec<CompiledHeader>,
    pub response_body: Option<String>,
}

impl CompiledRule {
    /// Branchless request-to-rule filter.
    ///
    /// For pure rules (`host == "*"` and `path_prefix == "/"`), bypasses string matching entirely.
    #[inline(always)]
    pub fn matches_request(&self, host: &[u8], path: &[u8]) -> bool {
        if self.is_pure {
            return true;
        }
        (self.is_wildcard_host || host_matches(self.host.as_bytes(), host))
            && (self.is_root_path || path_matches(self.path_prefix.as_bytes(), path))
    }

    /// Resolves the tracking key identifier based on rule configuration.
    #[inline(always)]
    pub fn resolve_identifier<'a>(
        &self,
        client_ip: &'a [u8],
        path: &'a [u8],
        header_lookup: &impl Fn(&str) -> Option<&'a [u8]>,
    ) -> &'a [u8] {
        match self.limit_by {
            LimitBy::ClientIp => client_ip,
            LimitBy::RoutePath => path,
            LimitBy::Header => {
                if let Some(ref h_name) = self.header_name {
                    header_lookup(h_name).unwrap_or(client_ip)
                } else {
                    client_ip
                }
            }
        }
    }
}

pub struct ConnectionLimitEngine {
    generation: u64,
    mode: ConnLimitMode,
    rules: Vec<CompiledRule>,
    pub(crate) local_tracker: Arc<ShardedConnTracker>,
    redis: Option<RedisConnectionLimiter>,
    is_async_batch_sync: bool,
}

#[inline(always)]
fn path_matches(prefix: &[u8], path: &[u8]) -> bool {
    if path.len() < prefix.len() || !path.starts_with(prefix) {
        return false;
    }
    if prefix == b"/" || prefix.ends_with(b"/") {
        return true;
    }
    path.len() == prefix.len() || path[prefix.len()] == b'/'
}

fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut result = template.to_string();
    for &(var, val) in vars {
        result = result.replace(var, val);
    }
    result
}

fn apply_custom_response(
    decision: &mut ConnLimitDecision,
    rule: &CompiledRule,
    current_connections: u32,
) {
    if rule.response_headers.is_empty() && rule.response_body.is_none() {
        return;
    }

    let limit_str = rule.max_connections.to_string();
    let current_str = current_connections.to_string();
    let status_code_str = decision.status_code.to_string();

    let vars: [(&str, &str); 8] = [
        ("${limit}", &limit_str),
        ("$limit", &limit_str),
        ("${current_connections}", &current_str),
        ("$current_connections", &current_str),
        ("${rejected_code}", &status_code_str),
        ("$rejected_code", &status_code_str),
        ("${rule_id}", &rule.id),
        ("$rule_id", &rule.id),
    ];

    let mut resolved_headers = Vec::with_capacity(rule.response_headers.len());
    for h in &rule.response_headers {
        resolved_headers.push(ResolvedHeader {
            name: h.name.clone(),
            value: render_template(&h.value, &vars),
        });
    }
    decision.headers = resolved_headers;

    if let Some(ref body_template) = rule.response_body {
        decision.body = Some(render_template(body_template, &vars).into_bytes());
    }
}

impl ConnectionLimitEngine {
    /// Compiles a new `ConnectionLimitEngine` from raw policy JSON bytes.
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_CONN_LIMIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut policy: ConnectionLimitPolicy =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        policy.validate().map_err(|_| Error::InvalidPolicy)?;

        policy
            .rules
            .sort_by_key(|r| (r.priority, host_specificity(&r.host), r.id.clone()));

        let mut rules = Vec::with_capacity(policy.rules.len());
        for rule in policy.rules {
            let rejected_code = match rule.rejected_code {
                Some(code) if (200..=599).contains(&code) => code,
                Some(_) => return Err(Error::InvalidPolicy),
                None => match rule.action_on_exceeded {
                    ActionOnExceeded::Throttle => 503,
                    ActionOnExceeded::Block => 403,
                    ActionOnExceeded::Audit => 200,
                    ActionOnExceeded::CustomResponse => 503,
                },
            };

            let response_headers = match rule.response_headers {
                Some(headers) => {
                    let mut compiled = Vec::with_capacity(headers.len());
                    for h in headers {
                        if h.name.len() > 64 || h.value.len() > 512 {
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

            let is_wildcard_host = rule.host == "*";
            let is_root_path = rule.path_prefix == "/";
            let is_pure = is_wildcard_host && is_root_path;
            let id_hash_prefix = ShardedConnTracker::precompute_rule_hash(rule.id.as_bytes());

            rules.push(CompiledRule {
                id_hash_prefix,
                id: rule.id,
                host: rule.host,
                path_prefix: rule.path_prefix,
                is_wildcard_host,
                is_root_path,
                is_pure,
                limit_by: rule.limit_by,
                header_name: rule.header_name,
                max_connections: rule.max_connections,
                action_on_exceeded: rule.action_on_exceeded,
                rejected_code,
                response_headers,
                response_body: rule.response_body,
            });
        }

        let redis = match policy.mode {
            ConnLimitMode::Local => None,
            ConnLimitMode::Distributed => {
                let cfg = policy.redis.as_ref().ok_or(Error::InvalidPolicy)?;
                Some(RedisConnectionLimiter::new(cfg)?)
            }
        };

        let is_async_batch_sync = match policy.mode {
            ConnLimitMode::Local => false,
            ConnLimitMode::Distributed => policy
                .redis
                .as_ref()
                .map(|r| r.sync_interval_ms > 0)
                .unwrap_or(false),
        };

        let local_tracker = Arc::new(ShardedConnTracker::new());

        if is_async_batch_sync && let Some(ref r) = redis {
            let tracker_clone = Arc::clone(&local_tracker);
            let pool_clone = Arc::clone(&r.pool);
            let sync_interval = std::time::Duration::from_millis(
                policy
                    .redis
                    .as_ref()
                    .map(|rc| rc.sync_interval_ms)
                    .unwrap_or(500),
            );
            let lease_ttl = r.lease_ttl_secs;

            let _ = aurora_engine::shadow::try_dispatch_shadow(Box::pin(async move {
                super::redis_sync::run_conn_limit_redis_shadow_sync(
                    tracker_clone,
                    pool_clone,
                    sync_interval,
                    lease_ttl,
                )
                .await;
            }));
        }

        Ok(Self {
            generation: policy.generation,
            mode: policy.mode,
            rules,
            local_tracker,
            redis,
            is_async_batch_sync,
        })
    }

    #[inline]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[inline]
    pub fn acquire_ctx<'a, 'h: 'a>(
        &self,
        ctx: &crate::AccessRequestContext<'h>,
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<ConnLimitDecision, Error> {
        self.acquire(ctx.host, ctx.path, ctx.client_ip, header_lookup)
    }

    pub fn acquire<'a>(
        &self,
        host: &[u8],
        path: &'a [u8],
        client_ip: &'a [u8],
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<ConnLimitDecision, Error> {
        if host.is_empty()
            || host.len() > 253
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || path[0] != b'/'
            || client_ip.is_empty()
            || client_ip.len() > 64
        {
            return Err(Error::InvalidRequest);
        }

        for rule in &self.rules {
            if !rule.matches_request(host, path) {
                continue;
            }

            let identifier = rule.resolve_identifier(client_ip, path, &header_lookup);

            // Fast numerical hashing continuing from precomputed rule prefix
            let key_hash = ShardedConnTracker::hash_with_prefix(rule.id_hash_prefix, identifier);

            let (allowed, current, is_redis) = match self.mode {
                ConnLimitMode::Local => {
                    let (ok, cur) = self
                        .local_tracker
                        .acquire_hash(key_hash, rule.max_connections);
                    (ok, cur, false)
                }
                ConnLimitMode::Distributed => {
                    if self.is_async_batch_sync {
                        let (ok, cur) = self.local_tracker.acquire_hash_with_key(
                            key_hash,
                            rule.max_connections,
                            || {
                                let id_str = String::from_utf8_lossy(identifier);
                                format!("aurora:cl:cluster:{}:{id_str}", rule.id)
                            },
                        );
                        (ok, cur, false)
                    } else if let Some(ref redis) = self.redis {
                        match redis.acquire(&rule.id, identifier, rule.max_connections) {
                            Ok((ok, cur)) => (ok, cur, true),
                            Err(_) => match redis.on_error {
                                OnErrorAction::FallbackLocal => {
                                    let (ok, cur) = self
                                        .local_tracker
                                        .acquire_hash(key_hash, rule.max_connections);
                                    (ok, cur, false)
                                }
                                OnErrorAction::Pass => (true, 0, false),
                                OnErrorAction::Block => (false, rule.max_connections, false),
                            },
                        }
                    } else {
                        let (ok, cur) = self
                            .local_tracker
                            .acquire_hash(key_hash, rule.max_connections);
                        (ok, cur, false)
                    }
                }
            };

            let mut decision = if allowed {
                ConnLimitDecision {
                    allowed: true,
                    action: ActionOnExceeded::Throttle,
                    status_code: 200,
                    current_connections: current,
                    max_connections: rule.max_connections,
                    token: Some(ConnLimitToken {
                        rule_id: rule.id.clone(),
                        identifier: identifier.to_vec(),
                        key_hash,
                        is_redis,
                    }),
                    headers: Vec::new(),
                    body: None,
                }
            } else {
                ConnLimitDecision {
                    allowed: false,
                    action: rule.action_on_exceeded,
                    status_code: rule.rejected_code,
                    current_connections: current,
                    max_connections: rule.max_connections,
                    token: None,
                    headers: Vec::new(),
                    body: None,
                }
            };

            if !allowed {
                apply_custom_response(&mut decision, rule, current);
            }

            return Ok(decision);
        }

        // No rule matched: allow without token
        Ok(ConnLimitDecision {
            allowed: true,
            action: ActionOnExceeded::Throttle,
            status_code: 200,
            current_connections: 0,
            max_connections: 0,
            token: None,
            headers: Vec::new(),
            body: None,
        })
    }

    /// Direct numerical 64-bit key_hash release for zero-allocation hot-path.
    #[inline(always)]
    pub fn release_hash(&self, key_hash: u64) {
        self.local_tracker.release_hash(key_hash);
    }

    /// Releases an acquired connection slot.
    pub fn release(&self, token: &ConnLimitToken) {
        if token.is_redis
            && let Some(ref redis) = self.redis
            && redis.release(&token.rule_id, &token.identifier).is_ok()
        {
            return;
        }

        let key_hash = if token.key_hash != 0 {
            token.key_hash
        } else {
            ShardedConnTracker::hash_key(token.rule_id.as_bytes(), &token.identifier)
        };
        self.local_tracker.release_hash(key_hash);
    }
}
