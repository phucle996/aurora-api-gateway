use super::types::{OnErrorAction, RedisConfigInput};
use crate::Error;
use crate::redis_pool::{RedisConnectionPool, RedisPoolKey, RedisPoolRegistry};
use redis::Script;
use std::sync::Arc;
use std::time::Duration;

pub const CONN_LIMIT_ACQUIRE_SCRIPT: &str = r#"
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl_secs = tonumber(ARGV[2])

local current = tonumber(redis.call("GET", key) or "0")
if current < limit then
    local new_val = redis.call("INCR", key)
    redis.call("EXPIRE", key, ttl_secs)
    return { 1, new_val, limit }
else
    return { 0, current, limit }
end
"#;

pub const CONN_LIMIT_RELEASE_SCRIPT: &str = r#"
local key = KEYS[1]

local current = tonumber(redis.call("GET", key) or "0")
if current <= 1 then
    redis.call("DEL", key)
    return 0
else
    local new_val = redis.call("DECR", key)
    return new_val
end
"#;

pub(crate) struct RedisConnectionLimiter {
    pool: Arc<RedisConnectionPool>,
    pub on_error: OnErrorAction,
    pub lease_ttl_secs: u32,
    acquire_script: Script,
    release_script: Script,
}

impl RedisConnectionLimiter {
    pub fn new(cfg: &RedisConfigInput) -> Result<Self, Error> {
        let timeout = Duration::from_millis(cfg.timeout_ms.clamp(1, 5000));
        let max_pool_size = cfg.pool_size.clamp(1, 64);
        let lease_ttl_secs = cfg.lease_ttl_secs.clamp(5, 86400);

        let key = RedisPoolKey {
            endpoint: cfg.endpoint.clone(),
            db: cfg.db,
            username: None,
            password: cfg.password.clone(),
            tls_enabled: cfg.tls.as_ref().map(|t| t.enabled).unwrap_or(false),
            insecure_skip_verify: cfg
                .tls
                .as_ref()
                .map(|t| t.insecure_skip_verify)
                .unwrap_or(false),
            ca_cert: cfg.tls.as_ref().and_then(|t| t.ca_cert_pem.clone()),
            client_cert: cfg.tls.as_ref().and_then(|t| t.client_cert_pem.clone()),
            client_key: cfg.tls.as_ref().and_then(|t| t.client_key_pem.clone()),
        };

        let pool = RedisPoolRegistry::global().get_or_create(key, timeout, max_pool_size)?;

        Ok(Self {
            pool,
            on_error: cfg.on_error,
            lease_ttl_secs,
            acquire_script: Script::new(CONN_LIMIT_ACQUIRE_SCRIPT),
            release_script: Script::new(CONN_LIMIT_RELEASE_SCRIPT),
        })
    }

    pub fn acquire(
        &self,
        rule_id: &str,
        identifier: &[u8],
        max_connections: u32,
    ) -> Result<(bool, u32), ()> {
        let mut conn = self.pool.get_connection()?;
        let id_str = String::from_utf8_lossy(identifier);
        let key = format!("aurora:cl:{}:{id_str}", rule_id);

        let res: Result<redis::Value, _> = self
            .acquire_script
            .key(&key)
            .arg(max_connections)
            .arg(self.lease_ttl_secs)
            .invoke(&mut conn);

        let val = match res {
            Ok(v) => {
                self.pool.return_connection(conn);
                v
            }
            Err(_) => return Err(()),
        };

        match val {
            redis::Value::Array(items) if items.len() >= 2 => {
                let to_i64 = |v: &redis::Value| match v {
                    redis::Value::Int(i) => Some(*i),
                    redis::Value::BulkString(d) => {
                        std::str::from_utf8(d).ok().and_then(|s| s.parse().ok())
                    }
                    redis::Value::SimpleString(s) => s.parse().ok(),
                    _ => None,
                };
                let allowed = to_i64(&items[0]).unwrap_or(0) == 1;
                let current = to_i64(&items[1]).unwrap_or(0).max(0) as u32;
                Ok((allowed, current))
            }
            _ => Err(()),
        }
    }

    pub fn release(&self, rule_id: &str, identifier: &[u8]) -> Result<(), ()> {
        let mut conn = self.pool.get_connection()?;
        let id_str = String::from_utf8_lossy(identifier);
        let key = format!("aurora:cl:{}:{id_str}", rule_id);

        let res: Result<redis::Value, _> = self.release_script.key(&key).invoke(&mut conn);

        match res {
            Ok(_) => {
                self.pool.return_connection(conn);
                Ok(())
            }
            Err(_) => Err(()),
        }
    }
}
