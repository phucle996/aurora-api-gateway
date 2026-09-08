//! Independent IP access snapshot. No policy state or controller calls in the request path.
use serde::Deserialize;
use std::net::IpAddr;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    schema_version: u32,
    generation: u64,
    rules: Vec<Rule>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    id: u64,
    priority: u32,
    action: String,
    networks: Vec<String>,
    host: String,
    path_prefix: String,
    method: String,
    schedule: String,
    expires_at: u64,
    log: bool,
    reputation: bool,
    alert: bool,
}
struct CompiledRule {
    rule: Rule,
    networks: Vec<(IpAddr, u32)>,
}
pub struct AccessEngine {
    generation: u64,
    rules: Vec<CompiledRule>,
}
pub struct AccessRequest<'a> {
    pub ip: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub now: u64,
}
impl AccessEngine {
    pub fn from_snapshot(bytes: &[u8]) -> Result<Self, crate::Error> {
        if bytes.is_empty() || bytes.len() > crate::MAX_POLICY_BYTES {
            return Err(crate::Error::InvalidPolicy);
        }
        let mut snap: Snapshot =
            serde_json::from_slice(bytes).map_err(|_| crate::Error::InvalidPolicy)?;
        if snap.schema_version != 1
            || (snap.generation == 0 && !snap.rules.is_empty())
            || snap.generation > i64::MAX as u64
            || snap.rules.len() > 512
        {
            return Err(crate::Error::InvalidPolicy);
        }
        snap.rules
            .sort_by_key(|r| (r.priority, crate::host_specificity(&r.host), r.id));
        let mut ids = std::collections::HashSet::new();
        let mut rules = Vec::new();
        for rule in snap.rules {
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

            if rule.id == 0
                || !ids.insert(rule.id)
                || !matches!(rule.action.as_str(), "allow" | "block" | "log")
                || rule.networks.is_empty()
                || rule.networks.len() > 4096
                || rule.priority > 1_000_000
                || rule.host.is_empty()
                || rule.host.len() > 253
                || !host_valid
                || !rule.path_prefix.starts_with('/')
                || rule.path_prefix.len() > 8192
                || rule
                    .path_prefix
                    .bytes()
                    .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
                || rule.path_prefix.contains("//")
                || rule.path_prefix.split('/').any(|s| s == "." || s == "..")
                || !matches!(
                    rule.method.as_str(),
                    "*" | "GET"
                        | "HEAD"
                        | "POST"
                        | "PUT"
                        | "PATCH"
                        | "DELETE"
                        | "OPTIONS"
                        | "CONNECT"
                        | "TRACE"
                )
                || !matches!(
                    rule.schedule.as_str(),
                    "always" | "business_hours" | "weekend" | "night"
                )
            {
                return Err(crate::Error::InvalidPolicy);
            }
            let mut networks = Vec::new();
            for cidr in &rule.networks {
                let (ip, bits) = cidr.split_once('/').ok_or(crate::Error::InvalidPolicy)?;
                let ip: IpAddr = ip.parse().map_err(|_| crate::Error::InvalidPolicy)?;
                let bits: u32 = bits.parse().map_err(|_| crate::Error::InvalidPolicy)?;
                if bits > if ip.is_ipv4() { 32 } else { 128 }
                    || matches!(ip,IpAddr::V6(v) if v.to_ipv4_mapped().is_some())
                {
                    return Err(crate::Error::InvalidPolicy);
                }
                networks.push((ip, bits));
            }
            rules.push(CompiledRule { rule, networks });
        }
        Ok(Self {
            generation: snap.generation,
            rules,
        })
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn evaluate(&self, q: AccessRequest<'_>) -> Result<crate::Decision, crate::Error> {
        let ip: IpAddr = std::str::from_utf8(q.ip)
            .map_err(|_| crate::Error::InvalidRequest)?
            .parse()
            .map_err(|_| crate::Error::InvalidRequest)?;
        let ip = match ip {
            IpAddr::V6(v) => v.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
            _ => ip,
        };
        if q.path.is_empty()
            || q.path.len() > crate::MAX_PATH_BYTES
            || q.path[0] != b'/'
            || q.host.len() > 253
            || q.method.len() > 16
        {
            return Err(crate::Error::InvalidRequest);
        }
        let mut decision = crate::Decision {
            generation: self.generation,
            ..Default::default()
        };
        let hour = (q.now / 3600) % 24;
        let weekday = (q.now / 86400 + 4) % 7;
        for compiled in &self.rules {
            let r = &compiled.rule;
            if (r.expires_at != 0 && q.now >= r.expires_at)
                || !crate::host_matches(r.host.as_bytes(), q.host)
                || (r.method != "*" && r.method.as_bytes() != q.method)
                || !q.path.starts_with(r.path_prefix.as_bytes())
                || (r.path_prefix != "/"
                    && !r.path_prefix.ends_with('/')
                    && q.path.len() > r.path_prefix.len()
                    && q.path[r.path_prefix.len()] != b'/')
            {
                continue;
            }
            if !match r.schedule.as_str() {
                "business_hours" => (1..=5).contains(&weekday) && (9..18).contains(&hour),
                "weekend" => weekday == 0 || weekday == 6,
                "night" => !(6..22).contains(&hour),
                _ => true,
            } {
                continue;
            }
            if !compiled
                .networks
                .iter()
                .any(|(network, bits)| match (ip, *network) {
                    (IpAddr::V4(a), IpAddr::V4(n)) => {
                        *bits == 0 || (u32::from(a) >> (32 - bits)) == (u32::from(n) >> (32 - bits))
                    }
                    (IpAddr::V6(a), IpAddr::V6(n)) => {
                        *bits == 0
                            || (u128::from(a) >> (128 - bits)) == (u128::from(n) >> (128 - bits))
                    }
                    _ => false,
                })
            {
                continue;
            }
            decision.rule_id = r.id;
            decision.action = u32::from(r.action == "block");
            decision.log_matches = u32::from(r.log || r.alert || r.reputation || r.action == "log");
            // A rule is terminal, including log-only, so its telemetry has one owner.
            return Ok(decision);
        }
        Ok(decision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_scope_expiry_and_untrusted_identity() {
        let e=AccessEngine::from_snapshot(br#"{"schema_version":1,"generation":2,"rules":[{"id":1,"priority":1,"action":"block","networks":["192.0.2.0/24","2001:db8::/32"],"host":"app.test","path_prefix":"/admin","method":"POST","schedule":"always","expires_at":100,"log":true,"reputation":true,"alert":true}]}"#).unwrap();
        for (ip, host, path, method, now, blocked) in [
            ("192.0.2.5", "APP.test", "/admin/x", "POST", 99, true),
            ("::ffff:192.0.2.5", "app.test", "/admin", "POST", 99, true),
            ("2001:db8::1", "app.test", "/admin", "POST", 99, true),
            ("192.0.3.5", "app.test", "/admin", "POST", 99, false),
            ("192.0.2.5", "other.test", "/admin", "POST", 99, false),
            ("192.0.2.5", "app.test", "/administrator", "POST", 99, false),
            ("192.0.2.5", "app.test", "/admin", "GET", 99, false),
            ("192.0.2.5", "app.test", "/admin", "POST", 100, false),
        ] {
            assert_eq!(
                e.evaluate(AccessRequest {
                    ip: ip.as_bytes(),
                    host: host.as_bytes(),
                    path: path.as_bytes(),
                    method: method.as_bytes(),
                    now
                })
                .unwrap()
                .action
                    == 1,
                blocked
            );
        }
    }

    #[test]
    fn wildcard_host_ip_access() {
        let e = AccessEngine::from_snapshot(br#"{"schema_version":1,"generation":1,"rules":[
            {"id":1,"priority":1,"action":"block","networks":["10.0.0.0/8"],"host":"*.corp.internal","path_prefix":"/","method":"*","schedule":"always","expires_at":0,"log":false,"reputation":false,"alert":false},
            {"id":2,"priority":1,"action":"allow","networks":["10.0.0.0/8"],"host":"public.corp.internal","path_prefix":"/","method":"*","schedule":"always","expires_at":0,"log":false,"reputation":false,"alert":false}
        ]}"#).unwrap();

        // public.corp.internal is exact match (priority 1, specificity 0, id 2) -> Allow (action 0)
        let res1 = e
            .evaluate(AccessRequest {
                ip: b"10.0.0.1",
                host: b"public.corp.internal",
                path: b"/index",
                method: b"GET",
                now: 10,
            })
            .unwrap();
        assert_eq!(res1.rule_id, 2);
        assert_eq!(res1.action, 0);

        // secret.corp.internal matches wildcard *.corp.internal -> Block (action 1)
        let res2 = e
            .evaluate(AccessRequest {
                ip: b"10.0.0.1",
                host: b"secret.corp.internal",
                path: b"/index",
                method: b"GET",
                now: 10,
            })
            .unwrap();
        assert_eq!(res2.rule_id, 1);
        assert_eq!(res2.action, 1);

        // corp.internal apex matches wildcard *.corp.internal -> Block (action 1)
        let res3 = e
            .evaluate(AccessRequest {
                ip: b"10.0.0.1",
                host: b"corp.internal",
                path: b"/index",
                method: b"GET",
                now: 10,
            })
            .unwrap();
        assert_eq!(res3.rule_id, 1);
        assert_eq!(res3.action, 1);

        // other.internal does not match -> default Allow
        let res4 = e
            .evaluate(AccessRequest {
                ip: b"10.0.0.1",
                host: b"other.internal",
                path: b"/index",
                method: b"GET",
                now: 10,
            })
            .unwrap();
        assert_eq!(res4.rule_id, 0);
        assert_eq!(res4.action, 0);
    }
}
