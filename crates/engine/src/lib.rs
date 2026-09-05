//! Immutable snapshots: all parsing/index construction happens before publication.
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

pub const MAX_POLICY_BYTES: usize = 65_536;
pub const MAX_PATH_BYTES: usize = 8_192;

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidPolicy,
    InvalidRequest,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    schema_version: u32,
    #[serde(default)]
    block_paths: Option<Vec<String>>,
    #[serde(default)]
    generation: Option<u64>,
    #[serde(default)]
    rules: Option<Vec<Rule>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    id: u64,
    path: String,
    action: Action,
    score: u32,
    priority: u32,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Action {
    Allow,
    Log,
    Block,
}

/// Values only; never exposes an allocation or request pointer across the ABI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct Decision {
    pub generation: u64,
    pub rule_id: u64,
    pub action: u32,
    pub score: u32,
    pub log_matches: u32,
    pub reserved: u32,
}

pub struct Engine {
    generation: u64,
    // Exact-path evaluation is precomputed. No per-request rule scan or mutation.
    decisions: HashMap<Vec<u8>, Decision>,
}

impl Engine {
    pub fn from_policy(bytes: &[u8]) -> Result<Self, Error> {
        if bytes.is_empty() || bytes.len() > MAX_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }
        let policy: Policy = serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;
        let (generation, mut rules) = match policy.schema_version {
            1 if policy.generation.is_none() && policy.rules.is_none() => {
                let paths = policy.block_paths.ok_or(Error::InvalidPolicy)?;
                let mut seen = HashSet::new();
                let mut rules = Vec::new();
                for path in paths {
                    if !seen.insert(path.clone()) {
                        return Err(Error::InvalidPolicy);
                    }
                    rules.push(Rule {
                        id: rules.len() as u64 + 1,
                        path,
                        action: Action::Block,
                        score: 0,
                        priority: 0,
                    });
                }
                (0, rules)
            }
            2 if policy.block_paths.is_none() => {
                let generation = policy
                    .generation
                    .filter(|g| *g > 0 && *g <= i64::MAX as u64)
                    .ok_or(Error::InvalidPolicy)?;
                (generation, policy.rules.ok_or(Error::InvalidPolicy)?)
            }
            _ => return Err(Error::InvalidPolicy),
        };
        if rules.len() > 1024 {
            return Err(Error::InvalidPolicy);
        }
        let mut ids = HashSet::new();
        for rule in &rules {
            if rule.id == 0
                || rule.id > i64::MAX as u64
                || !ids.insert(rule.id)
                || rule.score > 1000
                || rule.priority > 1_000_000
                || !rule.path.starts_with('/')
                || rule.path.len() > MAX_PATH_BYTES
                || !rule.path.is_ascii()
                || rule
                    .path
                    .bytes()
                    .any(|b| b <= 0x20 || b == 0x7f || b"%?#\\".contains(&b))
                || rule.path.contains("//")
                || rule.path.split('/').any(|p| p == "." || p == "..")
            {
                return Err(Error::InvalidPolicy);
            }
        }
        rules.sort_by_key(|r| (r.priority, r.id));
        let mut decisions = HashMap::new();
        let mut terminal = HashSet::new();
        for rule in rules {
            if terminal.contains(&rule.path) {
                continue;
            }
            let decision = decisions
                .entry(rule.path.as_bytes().to_vec())
                .or_insert(Decision {
                    generation,
                    ..Decision::default()
                });
            decision.rule_id = rule.id;
            decision.score += rule.score; // <= 1024 * 1000, validated above.
            match rule.action {
                Action::Log => decision.log_matches += 1,
                Action::Allow => {
                    terminal.insert(rule.path);
                }
                Action::Block => {
                    decision.action = 1;
                    terminal.insert(rule.path);
                }
            }
        }
        Ok(Self {
            generation,
            decisions,
        })
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn evaluate(&self, path: &[u8]) -> Result<Decision, Error> {
        if path.is_empty() || path.len() > MAX_PATH_BYTES || path[0] != b'/' || path.contains(&0) {
            return Err(Error::InvalidRequest);
        }
        Ok(self.decisions.get(path).copied().unwrap_or(Decision {
            generation: self.generation,
            ..Decision::default()
        }))
    }

    pub fn blocked(&self, path: &[u8]) -> Result<bool, Error> {
        Ok(self.evaluate(path)?.action == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_bounds() {
        let e = Engine::from_policy(br#"{"schema_version":1,"block_paths":["/blocked"]}"#).unwrap();
        assert_eq!(e.blocked(b"/blocked"), Ok(true));
        assert_eq!(e.blocked(b"/blocked/child"), Ok(false));
        assert_eq!(e.blocked(b""), Err(Error::InvalidRequest));
        assert!(e.blocked(&vec![b'/'; MAX_PATH_BYTES + 1]).is_err());
    }
    #[test]
    fn ordered_actions_and_snapshot_isolation() {
        let old = Engine::from_policy(
            br#"{"schema_version":2,"generation":7,"rules":[
          {"id":3,"path":"/a","action":"block","score":9,"priority":3},
          {"id":2,"path":"/a","action":"allow","score":1,"priority":2},
          {"id":1,"path":"/a","action":"log","score":5,"priority":1}] }"#,
        )
        .unwrap();
        let new = Engine::from_policy(br#"{"schema_version":2,"generation":8,"rules":[{"id":3,"path":"/a","action":"block","score":9,"priority":3}]}"#).unwrap();
        assert_eq!(
            old.evaluate(b"/a").unwrap(),
            Decision {
                generation: 7,
                rule_id: 2,
                action: 0,
                score: 6,
                log_matches: 1,
                reserved: 0
            }
        );
        assert!(new.blocked(b"/a").unwrap());
        assert!(!old.blocked(b"/a").unwrap());
        assert_eq!(new.evaluate(b"/other").unwrap().generation, 8);
    }
    #[test]
    fn invalid_policy() {
        for bytes in [
            br#"{"schema_version":2,"block_paths":[]}"#.as_slice(),
            br#"{"schema_version":1,"block_paths":["/a","/a"]}"#,
            br#"{"schema_version":1,"block_paths":["/%61"]}"#,
            br#"{"schema_version":1,"block_paths":["/a/../b"]}"#,
            br#"{"schema_version":1,"block_paths":[],"unknown":true}"#,
            br#"{"schema_version":2,"generation":1,"rules":[{"id":1,"path":"/a","action":"rate_limit","priority":0,"score":0}]}"#,
            b"bad json",
        ] { assert!(Engine::from_policy(bytes).is_err()); }
        assert!(Engine::from_policy(&vec![b' '; MAX_POLICY_BYTES + 1]).is_err());
    }
}
