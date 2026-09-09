use crate::config::Config;
use crate::grpc::pb::{HealthStatus, HeartbeatRequest, NginxMetadata};
use crate::grpc::GrpcClient;
use crate::nginx::NginxManager;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{error, info};

pub struct SimpleRng(u64);

impl SimpleRng {
    pub fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        Self(seed ^ 0x9e3779b97f4a7c15)
    }

    pub fn next_interval_ms(&mut self, base_secs: u64, jitter_percent: f64) -> u64 {
        let base_ms = (base_secs * 1000) as f64;
        let delta = base_ms * jitter_percent;
        let min_ms = (base_ms - delta).max(1000.0) as u64;
        let max_ms = (base_ms + delta) as u64;

        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        min_ms + (self.0 % (max_ms - min_ms + 1))
    }
}

pub async fn run_heartbeat_loop(
    cfg: Arc<Config>,
    client: GrpcClient,
    nginx: Arc<NginxManager>,
    started_at: i64,
) {
    let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "aurora-dataplane".into());
    let role = "dataplane-appliance".to_string();
    let worker_identity = format!("agent-{}", cfg.node_id);

    let mut rng = SimpleRng::new();
    let mut cached_digest = String::new();
    let mut metadata_synced = false;
    let mut active_release_id: i64 = 1;

    let nginx_version = nginx.get_version().await;

    loop {
        // Sleep with +-20% jitter around configured interval (e.g. 4s - 6s for 5s base)
        let delay_ms = rng.next_interval_ms(cfg.heartbeat_interval_secs, 0.20);
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let is_running = nginx.is_running().await;
        let master_pid = nginx.master_pid().await as i64;

        let status = if is_running {
            HealthStatus::Serving as i32
        } else {
            HealthStatus::Down as i32
        };

        let metadata = NginxMetadata {
            version: nginx_version.clone(),
            master_pid,
            worker_count: 1,
            active_release_id,
            runtime_started_at: started_at,
            hostname: hostname.clone(),
            role: role.clone(),
            worker_identity: worker_identity.clone(),
        };

        // Compute metadata digest in RAM
        let raw_meta = format!(
            "{}:{}:{}:{}:{}:{}:{}",
            metadata.version,
            metadata.master_pid,
            metadata.worker_count,
            metadata.active_release_id,
            metadata.runtime_started_at,
            metadata.hostname,
            metadata.worker_identity
        );
        let mut hasher = Sha256::new();
        hasher.update(raw_meta.as_bytes());
        let current_digest = hex::encode(hasher.finalize());

        // Only attach full metadata if digest changed or controller hasn't acknowledged yet
        let metadata_payload = if !metadata_synced || current_digest != cached_digest {
            Some(metadata)
        } else {
            None
        };

        let req = HeartbeatRequest {
            node_id: cfg.node_id.clone(),
            timestamp: now,
            status,
            active_release_id,
            metadata_digest: current_digest.clone(),
            metadata: metadata_payload,
        };

        match client.send_heartbeat(req).await {
            Ok(data) => {
                if data.metadata_acknowledged {
                    cached_digest = current_digest;
                    metadata_synced = true;
                }

                if data.action.as_str() == "reload" || data.action.as_str() == "reload_process" {
                    info!("Heartbeat directive requested reload");
                    if let Err(e) = nginx.reload().await {
                        error!("Failed to reload NGINX on directive: {}", e);
                    } else if data.desired_release_id > 0 {
                        active_release_id = data.desired_release_id;
                    }
                }
            }
            Err(e) => {
                error!("Failed to send heartbeat via gRPC: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heartbeat_request_creation() {
        let req = HeartbeatRequest {
            node_id: "node-test-01".into(),
            timestamp: 1700000000,
            status: HealthStatus::Serving as i32,
            active_release_id: 42,
            metadata_digest: "abcd1234".into(),
            metadata: None,
        };

        assert_eq!(req.node_id, "node-test-01");
        assert_eq!(req.active_release_id, 42);
        assert_eq!(req.status, HealthStatus::Serving as i32);
    }

    #[test]
    fn test_jitter_interval_range() {
        let mut rng = SimpleRng::new();
        for _ in 0..100 {
            let delay = rng.next_interval_ms(5, 0.20);
            assert!(delay >= 4000 && delay <= 6000, "delay {} out of range", delay);
        }
    }
}
