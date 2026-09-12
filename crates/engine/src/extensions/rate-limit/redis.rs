use super::types::{
    ActionOnExceeded, CompiledRule, OnErrorAction, RateLimitAlgorithm, RateLimitDecision,
    RedisConfigInput,
};
use crate::Error;
use crate::redis_pool::{RedisConnectionPool, RedisPoolKey, RedisPoolRegistry};
use redis::Script;
use std::sync::Arc;
use std::time::Duration;

pub const TOKEN_BUCKET_SCRIPT: &str = r#"
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local period_secs = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local now_secs = math.floor(now_ms / 1000)

local data = redis.call("HMGET", key, "tokens", "last_updated_ms")
local tokens = tonumber(data[1])
local last_updated_ms = tonumber(data[2])

if not tokens or not last_updated_ms then
    tokens = burst
    last_updated_ms = now_ms
else
    local elapsed_ms = math.max(0, now_ms - last_updated_ms)
    local refill = (elapsed_ms * rate) / (period_secs * 1000)
    tokens = math.min(burst, tokens + refill)
    last_updated_ms = now_ms
end

local allowed = 0
local retry_after = 0
if tokens >= 1.0 then
    allowed = 1
    tokens = tokens - 1.0
else
    local needed = 1.0 - tokens
    local wait_ms = math.ceil((needed * period_secs * 1000) / rate)
    retry_after = math.max(1, math.ceil(wait_ms / 1000))
end

redis.call("HMSET", key, "tokens", tokens, "last_updated_ms", last_updated_ms)
redis.call("EXPIRE", key, period_secs * 2 + 1)

local remaining = math.floor(math.max(0, tokens))
local reset_epoch = now_secs + period_secs

return { allowed, remaining, retry_after, reset_epoch }
"#;

pub const LEAKY_BUCKET_SCRIPT: &str = r#"
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local period_secs = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local now_secs = math.floor(now_ms / 1000)

local data = redis.call("HMGET", key, "watermark", "last_leak_ms")
local watermark = tonumber(data[1]) or 0.0
local last_leak_ms = tonumber(data[2]) or now_ms

local elapsed_ms = math.max(0, now_ms - last_leak_ms)
local leaked = (elapsed_ms * rate) / (period_secs * 1000)
watermark = math.max(0.0, watermark - leaked)
last_leak_ms = now_ms

local allowed = 0
local retry_after = 0
if watermark + 1.0 <= burst then
    allowed = 1
    watermark = watermark + 1.0
else
    local overflow = watermark + 1.0 - burst
    local wait_ms = math.ceil((overflow * period_secs * 1000) / rate)
    retry_after = math.max(1, math.ceil(wait_ms / 1000))
end

redis.call("HMSET", key, "watermark", watermark, "last_leak_ms", last_leak_ms)
redis.call("EXPIRE", key, period_secs * 2 + 1)

local remaining = math.floor(math.max(0, burst - watermark))
local reset_epoch = now_secs + period_secs

return { allowed, remaining, retry_after, reset_epoch }
"#;

pub const FIXED_WINDOW_SCRIPT: &str = r#"
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local period_secs = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local now_secs = math.floor(now_ms / 1000)

local window = math.floor(now_secs / period_secs)
local window_key = key .. ":" .. window

local current = redis.call("INCR", window_key)
if current == 1 then
    redis.call("EXPIRE", window_key, period_secs * 2 + 1)
end

local allowed = 0
local remaining = 0
local retry_after = 0
local limit = burst > 0 and burst or rate

if current <= limit then
    allowed = 1
    remaining = math.max(0, limit - current)
else
    allowed = 0
    remaining = 0
    retry_after = math.max(1, (window + 1) * period_secs - now_secs)
end

local reset_epoch = (window + 1) * period_secs
return { allowed, remaining, retry_after, reset_epoch }
"#;

pub const SLIDING_WINDOW_SCRIPT: &str = r#"
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local period_secs = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local now_ms = tonumber(ARGV[4])
local now_secs = math.floor(now_ms / 1000)

local window_ms = period_secs * 1000
local min_score = now_ms - window_ms

redis.call("ZREMRANGEBYSCORE", key, 0, min_score)
local current = redis.call("ZCARD", key)

local allowed = 0
local remaining = 0
local retry_after = 0
local limit = burst > 0 and burst or rate

if current < limit then
    allowed = 1
    redis.call("ZADD", key, now_ms, tostring(now_ms) .. "-" .. tostring(current + 1))
    remaining = math.max(0, limit - current - 1)
else
    allowed = 0
    remaining = 0
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    if oldest and #oldest >= 2 then
        local oldest_ms = tonumber(oldest[2])
        retry_after = math.max(1, math.ceil((oldest_ms + window_ms - now_ms) / 1000))
    else
        retry_after = 1
    end
end

redis.call("EXPIRE", key, period_secs * 2 + 1)
local reset_epoch = now_secs + period_secs

return { allowed, remaining, retry_after, reset_epoch }
"#;

pub(crate) struct RedisRateLimiter {
    pool: Arc<RedisConnectionPool>,
    pub on_error: OnErrorAction,
    script: Script,
    algo_tag: &'static str,
}

impl RedisRateLimiter {
    pub fn new(cfg: &RedisConfigInput, algorithm: RateLimitAlgorithm) -> Result<Self, Error> {
        let timeout = Duration::from_millis(cfg.timeout_ms.clamp(1, 5000));
        let max_pool_size = cfg.pool_size.clamp(1, 64);

        let script = if let Some(ref custom_lua) = cfg.custom_lua_script {
            if custom_lua.trim().is_empty() {
                return Err(Error::InvalidPolicy);
            }
            Script::new(custom_lua)
        } else {
            match algorithm {
                RateLimitAlgorithm::TokenBucket => Script::new(TOKEN_BUCKET_SCRIPT),
                RateLimitAlgorithm::LeakyBucket => Script::new(LEAKY_BUCKET_SCRIPT),
                RateLimitAlgorithm::FixedWindow => Script::new(FIXED_WINDOW_SCRIPT),
                RateLimitAlgorithm::SlidingWindow => Script::new(SLIDING_WINDOW_SCRIPT),
            }
        };

        let algo_tag = if cfg.custom_lua_script.is_some() {
            "custom"
        } else {
            match algorithm {
                RateLimitAlgorithm::TokenBucket => "tb",
                RateLimitAlgorithm::LeakyBucket => "lb",
                RateLimitAlgorithm::FixedWindow => "fw",
                RateLimitAlgorithm::SlidingWindow => "sw",
            }
        };

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
            script,
            algo_tag,
        })
    }

    fn get_connection(&self) -> Result<redis::Connection, ()> {
        self.pool.get_connection()
    }

    fn return_connection(&self, conn: redis::Connection) {
        self.pool.return_connection(conn);
    }

    pub fn evaluate(
        &self,
        _rule_idx: usize,
        rule: &CompiledRule,
        identifier: &[u8],
        now_ms: u64,
    ) -> Result<RateLimitDecision, ()> {
        let mut conn = self.get_connection()?;

        let id_str = String::from_utf8_lossy(identifier);
        let key = format!("aurora:rl:{}:{}:{id_str}", self.algo_tag, rule.id);

        let res: Result<redis::Value, _> = self
            .script
            .key(&key)
            .arg(rule.rate)
            .arg(rule.period_secs)
            .arg(rule.burst)
            .arg(now_ms)
            .invoke(&mut conn);

        let val = match res {
            Ok(v) => {
                self.return_connection(conn);
                v
            }
            Err(_) => return Err(()),
        };

        let (allowed_int, remaining, retry_after, reset_epoch, custom_reason) = match val {
            redis::Value::Array(items) if items.len() >= 4 => {
                let to_i64 = |v: &redis::Value| match v {
                    redis::Value::Int(i) => Some(*i),
                    redis::Value::BulkString(d) => {
                        std::str::from_utf8(d).ok().and_then(|s| s.parse().ok())
                    }
                    redis::Value::SimpleString(s) => s.parse().ok(),
                    _ => None,
                };
                let allowed = to_i64(&items[0]).unwrap_or(0);
                let remaining = to_i64(&items[1]).unwrap_or(0);
                let retry_after = to_i64(&items[2]).unwrap_or(0);
                let reset_epoch = to_i64(&items[3]).unwrap_or(0);
                let reason = if items.len() >= 5 {
                    match &items[4] {
                        redis::Value::BulkString(d) => {
                            std::str::from_utf8(d).ok().map(|s| s.to_string())
                        }
                        redis::Value::SimpleString(s) => Some(s.clone()),
                        redis::Value::Int(i) => Some(i.to_string()),
                        _ => None,
                    }
                } else {
                    None
                };
                (allowed, remaining, retry_after, reset_epoch, reason)
            }
            _ => return Err(()),
        };

        let allowed = allowed_int == 1;
        let status_code = if allowed { 200 } else { rule.rejected_code };
        let action = if allowed {
            ActionOnExceeded::Throttle
        } else {
            rule.action_on_exceeded
        };

        Ok(RateLimitDecision {
            allowed,
            action,
            status_code,
            retry_after_secs: retry_after as u32,
            remaining: remaining as u32,
            reset_epoch_secs: reset_epoch as u64,
            custom_reason,
            headers: Vec::new(),
            body: None,
        })
    }
}
