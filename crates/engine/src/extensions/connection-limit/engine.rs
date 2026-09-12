use super::redis::RedisConnectionLimiter;
use super::tracker::ShardedConnTracker;
use super::types::{
    ActionOnExceeded, CompiledHeader, CompiledRule, ConnLimitDecision, ConnLimitMode,
    ConnLimitSnapshot, ConnLimitToken, LimitBy, MAX_CONN_LIMIT_POLICY_BYTES, MAX_CONN_LIMIT_RULES,
    OnErrorAction, ResolvedHeader,
};
use crate::{Error, MAX_PATH_BYTES, host_matches, host_specificity};

pub struct ConnectionLimitEngine {
    generation: u64,
    mode: ConnLimitMode,
    rules: Vec<CompiledRule>,
    local_tracker: ShardedConnTracker,
    redis: Option<RedisConnectionLimiter>,
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

fn apply_custom_response(
    decision: &mut ConnLimitDecision,
    rule: &CompiledRule,
    current_connections: u32,
) {
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
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_CONN_LIMIT_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        let mut snapshot: ConnLimitSnapshot =
            serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        if snapshot.schema_version != 1 {
            return Err(Error::InvalidPolicy);
        }

        if snapshot.rules.len() > MAX_CONN_LIMIT_RULES {
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
                    ActionOnExceeded::Throttle => 503,
                    ActionOnExceeded::Block => 403,
                    ActionOnExceeded::Audit => 200,
                    ActionOnExceeded::CustomResponse => 503,
                },
            };

            if rule.max_connections == 0
                || !host_valid
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > MAX_PATH_BYTES
            {
                return Err(Error::InvalidPolicy);
            }

            let response_headers = match rule.response_headers {
                Some(hdrs) => {
                    if hdrs.len() > 8 {
                        return Err(Error::InvalidPolicy);
                    }
                    let mut compiled = Vec::with_capacity(hdrs.len());
                    for h in hdrs {
                        if h.name.trim().is_empty()
                            || h.name.len() > 64
                            || h.value.len() > 256
                            || !h
                                .name
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                        {
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

            rules.push(CompiledRule {
                id: rule.id,
                host: rule.host,
                path_prefix: rule.path_prefix,
                limit_by,
                header_name,
                max_connections: rule.max_connections,
                action_on_exceeded: rule.action_on_exceeded,
                rejected_code,
                response_headers,
                response_body: rule.response_body,
            });
        }

        let redis = match snapshot.mode {
            ConnLimitMode::Local => None,
            ConnLimitMode::Distributed => {
                let cfg = snapshot.redis.as_ref().ok_or(Error::InvalidPolicy)?;
                Some(RedisConnectionLimiter::new(cfg)?)
            }
        };

        Ok(Self {
            generation: snapshot.generation,
            mode: snapshot.mode,
            rules,
            local_tracker: ShardedConnTracker::new(),
            redis,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn acquire<'a>(
        &self,
        host: &[u8],
        path: &[u8],
        client_ip: &[u8],
        header_lookup: impl Fn(&str) -> Option<&'a [u8]>,
    ) -> Result<ConnLimitDecision, Error> {
        if host.is_empty()
            || host.len() > 253
            || path.is_empty()
            || path.len() > MAX_PATH_BYTES
            || !path.starts_with(b"/")
            || client_ip.is_empty()
            || client_ip.len() > 64
        {
            return Err(Error::InvalidRequest);
        }

        for rule in &self.rules {
            if !host_matches(rule.host.as_bytes(), host) {
                continue;
            }
            if !path_matches(rule.path_prefix.as_bytes(), path) {
                continue;
            }

            let identifier = match rule.limit_by {
                LimitBy::ClientIp => client_ip,
                LimitBy::RoutePath => path,
                LimitBy::Header => {
                    if let Some(ref h_name) = rule.header_name {
                        header_lookup(h_name).unwrap_or(client_ip)
                    } else {
                        client_ip
                    }
                }
            };

            let mut tracker_key = Vec::with_capacity(rule.id.len() + 1 + identifier.len());
            tracker_key.extend_from_slice(rule.id.as_bytes());
            tracker_key.push(b':');
            tracker_key.extend_from_slice(identifier);

            let (allowed, current, is_redis) = match self.mode {
                ConnLimitMode::Local => {
                    let (ok, cur) = self
                        .local_tracker
                        .acquire(&tracker_key, rule.max_connections);
                    (ok, cur, false)
                }
                ConnLimitMode::Distributed => {
                    if let Some(ref redis) = self.redis {
                        match redis.acquire(&rule.id, identifier, rule.max_connections) {
                            Ok((ok, cur)) => (ok, cur, true),
                            Err(_) => match redis.on_error {
                                OnErrorAction::FallbackLocal => {
                                    let (ok, cur) = self
                                        .local_tracker
                                        .acquire(&tracker_key, rule.max_connections);
                                    (ok, cur, false)
                                }
                                OnErrorAction::Pass => (true, 0, false),
                                OnErrorAction::Block => (false, rule.max_connections, false),
                            },
                        }
                    } else {
                        let (ok, cur) = self
                            .local_tracker
                            .acquire(&tracker_key, rule.max_connections);
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

    pub fn release(&self, token: &ConnLimitToken) {
        if token.is_redis
            && let Some(ref redis) = self.redis
            && redis.release(&token.rule_id, &token.identifier).is_ok()
        {
            return;
        }

        let mut tracker_key = Vec::with_capacity(token.rule_id.len() + 1 + token.identifier.len());
        tracker_key.extend_from_slice(token.rule_id.as_bytes());
        tracker_key.push(b':');
        tracker_key.extend_from_slice(&token.identifier);
        self.local_tracker.release(&tracker_key);
    }
}
