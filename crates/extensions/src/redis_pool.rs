//! Shared Redis Connection Pool and Registry.
//!
//! Provides threadless, fork-safe connection pooling for Redis across
//! extensions (such as rate-limiting and connection-limiting) with:
//! - Pool reuse when connection parameters match.
//! - Lazy connections (no sockets created upfront).
//! - Fail-fast socket read/write timeouts.
//! - Capped maximum unique pools (max 8) to prevent resource exhaustion.

use crate::Error;
use redis::{Client, ClientTlsConfig, Connection, TlsCertificates};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

pub const MAX_REDIS_POOLS: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RedisPoolKey {
    pub endpoint: String,
    pub db: Option<i64>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub tls_enabled: bool,
    pub insecure_skip_verify: bool,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
}

pub struct RedisConnectionPool {
    client: Client,
    pool: Mutex<Vec<Connection>>,
    max_size: usize,
    timeout: Duration,
}

impl RedisConnectionPool {
    pub fn new(key: &RedisPoolKey, timeout: Duration, max_size: usize) -> Result<Self, Error> {
        let mut endpoint = key.endpoint.clone();

        if key.tls_enabled && endpoint.starts_with("redis://") {
            endpoint = format!("rediss://{}", &endpoint[8..]);
        }
        if key.insecure_skip_verify && !endpoint.contains("insecure_skip_verify") {
            let separator = if endpoint.contains('?') { '&' } else { '?' };
            endpoint = format!("{}{}insecure_skip_verify=true", endpoint, separator);
        }

        if let Some(ref pwd) = key
            .password
            .as_deref()
            .filter(|p| !p.is_empty() && !endpoint.contains('@'))
        {
            if let Some(user) = key.username.as_deref().filter(|u| !u.is_empty()) {
                if let Some(stripped) = endpoint.strip_prefix("redis://") {
                    endpoint = format!("redis://{}:{}@{}", user, pwd, stripped);
                } else if let Some(stripped) = endpoint.strip_prefix("rediss://") {
                    endpoint = format!("rediss://{}:{}@{}", user, pwd, stripped);
                }
            } else if let Some(stripped) = endpoint.strip_prefix("redis://") {
                endpoint = format!("redis://:{}@{}", pwd, stripped);
            } else if let Some(stripped) = endpoint.strip_prefix("rediss://") {
                endpoint = format!("rediss://:{}@{}", pwd, stripped);
            }
        }

        if let Some(db) = key
            .db
            .filter(|_| !endpoint.contains('/') || endpoint.ends_with('/'))
        {
            endpoint = format!("{}/{}", endpoint.trim_end_matches('/'), db);
        }

        let client = if key.tls_enabled {
            let root_cert = key.ca_cert.as_ref().map(|pem| pem.as_bytes().to_vec());
            let client_tls = match (&key.client_cert, &key.client_key) {
                (Some(cert), Some(k)) => Some(ClientTlsConfig {
                    client_cert: cert.as_bytes().to_vec(),
                    client_key: k.as_bytes().to_vec(),
                }),
                _ => None,
            };

            if root_cert.is_some() || client_tls.is_some() {
                let certs = TlsCertificates {
                    client_tls,
                    root_cert,
                };
                Client::build_with_tls(endpoint.as_str(), certs)
                    .map_err(|_| Error::InvalidPolicy)?
            } else {
                Client::open(endpoint.as_str()).map_err(|_| Error::InvalidPolicy)?
            }
        } else {
            Client::open(endpoint.as_str()).map_err(|_| Error::InvalidPolicy)?
        };

        Ok(Self {
            client,
            pool: Mutex::new(Vec::new()),
            max_size: max_size.clamp(1, 64),
            timeout,
        })
    }

    #[allow(clippy::result_unit_err)]
    pub fn get_connection(&self) -> Result<Connection, ()> {
        if let Some(conn) = self.pool.lock().ok().and_then(|mut p| p.pop()) {
            return Ok(conn);
        }
        let conn = self
            .client
            .get_connection_with_timeout(self.timeout)
            .map_err(|_| ())?;
        let _ = conn.set_read_timeout(Some(self.timeout));
        let _ = conn.set_write_timeout(Some(self.timeout));
        Ok(conn)
    }

    pub fn return_connection(&self, conn: Connection) {
        if let Ok(mut p) = self.pool.lock()
            && p.len() < self.max_size
        {
            p.push(conn);
        }
    }
}

pub struct RedisPoolRegistry {
    pools: Mutex<HashMap<RedisPoolKey, Arc<RedisConnectionPool>>>,
}

impl RedisPoolRegistry {
    pub fn global() -> &'static Self {
        static REGISTRY: OnceLock<RedisPoolRegistry> = OnceLock::new();
        REGISTRY.get_or_init(|| RedisPoolRegistry {
            pools: Mutex::new(HashMap::new()),
        })
    }

    pub fn get_or_create(
        &self,
        key: RedisPoolKey,
        timeout: Duration,
        max_size: usize,
    ) -> Result<Arc<RedisConnectionPool>, Error> {
        let mut pools = self.pools.lock().map_err(|_| Error::InvalidPolicy)?;
        if let Some(existing) = pools.get(&key) {
            return Ok(Arc::clone(existing));
        }

        if pools.len() >= MAX_REDIS_POOLS {
            return Err(Error::InvalidPolicy);
        }

        let pool = Arc::new(RedisConnectionPool::new(&key, timeout, max_size)?);
        pools.insert(key, Arc::clone(&pool));
        Ok(pool)
    }

    #[cfg(test)]
    pub fn pool_count(&self) -> usize {
        self.pools.lock().map(|p| p.len()).unwrap_or(0)
    }
}
