use crate::config::Config;
use crate::nginx::NginxManager;
use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{error, info};

#[derive(Debug, Clone, Default)]
pub struct HeartbeatPayload {
    pub node_id: String,
    pub timestamp: i64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub active_connections: i64,
    pub requests_per_second: f64,
    pub active_release_id: i64,
    pub version: String,
    pub role: String,
    pub metrics_scope: String,
    pub hostname: String,
    pub runtime_started_at: i64,
    pub worker_identity: String,
    pub metrics_available: bool,
}

impl HeartbeatPayload {
    pub fn to_protobuf_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(128);

        // Tag 1: node_id (string, wire type 2)
        if !self.node_id.is_empty() {
            encode_tag(&mut buf, 1, 2);
            encode_varint(&mut buf, self.node_id.len() as u64);
            buf.extend_from_slice(self.node_id.as_bytes());
        }

        // Tag 2: timestamp (int64, wire type 0)
        if self.timestamp != 0 {
            encode_tag(&mut buf, 2, 0);
            encode_varint(&mut buf, self.timestamp as u64);
        }

        // Tag 3: cpu_usage (double / fixed64, wire type 1)
        if self.cpu_usage != 0.0 {
            encode_tag(&mut buf, 3, 1);
            buf.extend_from_slice(&self.cpu_usage.to_bits().to_le_bytes());
        }

        // Tag 4: memory_usage (double / fixed64, wire type 1)
        if self.memory_usage != 0.0 {
            encode_tag(&mut buf, 4, 1);
            buf.extend_from_slice(&self.memory_usage.to_bits().to_le_bytes());
        }

        // Tag 5: active_connections (int64, wire type 0)
        if self.active_connections != 0 {
            encode_tag(&mut buf, 5, 0);
            encode_varint(&mut buf, self.active_connections as u64);
        }

        // Tag 6: requests_per_second (double / fixed64, wire type 1)
        if self.requests_per_second != 0.0 {
            encode_tag(&mut buf, 6, 1);
            buf.extend_from_slice(&self.requests_per_second.to_bits().to_le_bytes());
        }

        // Tag 7: active_release_id (int64, wire type 0)
        if self.active_release_id != 0 {
            encode_tag(&mut buf, 7, 0);
            encode_varint(&mut buf, self.active_release_id as u64);
        }

        // Tag 8: version (string, wire type 2)
        if !self.version.is_empty() {
            encode_tag(&mut buf, 8, 2);
            encode_varint(&mut buf, self.version.len() as u64);
            buf.extend_from_slice(self.version.as_bytes());
        }

        // Tag 9: role (string, wire type 2)
        if !self.role.is_empty() {
            encode_tag(&mut buf, 9, 2);
            encode_varint(&mut buf, self.role.len() as u64);
            buf.extend_from_slice(self.role.as_bytes());
        }

        for (tag, value) in [
            (10, &self.metrics_scope),
            (11, &self.hostname),
            (13, &self.worker_identity),
        ] {
            if !value.is_empty() {
                encode_tag(&mut buf, tag, 2);
                encode_varint(&mut buf, value.len() as u64);
                buf.extend_from_slice(value.as_bytes());
            }
        }
        encode_tag(&mut buf, 12, 0);
        encode_varint(&mut buf, self.runtime_started_at as u64);
        encode_tag(&mut buf, 14, 0);
        encode_varint(&mut buf, u64::from(self.metrics_available));
        buf
    }
}

fn encode_tag(buf: &mut Vec<u8>, field_number: u32, wire_type: u8) {
    encode_varint(buf, ((field_number as u64) << 3) | (wire_type as u64));
}

fn encode_varint(buf: &mut Vec<u8>, mut val: u64) {
    while val >= 0x80 {
        buf.push(((val & 0x7f) as u8) | 0x80);
        val >>= 7;
    }
    buf.push(val as u8);
}

#[derive(Deserialize, Debug)]
struct HeartbeatResponse {
    action: Option<String>,
}

pub async fn run_heartbeat_loop(
    cfg: Arc<Config>,
    client: Client,
    nginx: Arc<NginxManager>,
    started_at: i64,
) {
    let interval = tokio::time::Duration::from_secs(cfg.heartbeat_interval_secs);
    let mut ticker = tokio::time::interval(interval);

    let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "aurora-dataplane".into());

    let metrics_scope = std::env::var("AURORA_METRICS_SCOPE").unwrap_or_else(|_| "container".into());

    loop {
        ticker.tick().await;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let payload = HeartbeatPayload {
            node_id: cfg.node_id.clone(),
            timestamp: now,
            cpu_usage: 0.0,
            memory_usage: 0.0,
            active_connections: 0,
            requests_per_second: 0.0,
            active_release_id: 1,
            version: env!("CARGO_PKG_VERSION").to_string(),
            role: "dataplane-appliance".to_string(),
            metrics_scope: metrics_scope.clone(),
            hostname: hostname.clone(),
            runtime_started_at: started_at,
            worker_identity: format!("agent-{}", cfg.node_id),
            metrics_available: true,
        };

        let bytes = payload.to_protobuf_bytes();
        let url = format!("{}/api/v1/nodes/{}/heartbeat", cfg.controller_url, cfg.node_id);

        match client
            .post(&url)
            .header("Content-Type", "application/x-protobuf")
            .header("Authorization", format!("Bearer {}", cfg.auth_token))
            .body(bytes)
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() {
                    match resp.json::<HeartbeatResponse>().await {
                        Ok(data) if data.action.as_deref() == Some("reload") => {
                            info!("Heartbeat directive requested reload");
                            if let Err(e) = nginx.reload().await {
                                error!("Failed to reload NGINX on directive: {}", e);
                            }
                        }
                        _ => {}
                    }
                } else {
                    let text = resp.text().await.unwrap_or_default();
                    error!(error = %text, "Heartbeat rejected by controller");
                }
            }
            Err(e) => {
                error!("Failed to send heartbeat: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protobuf_serialization() {
        let payload = HeartbeatPayload {
            node_id: "node-test-01".into(),
            timestamp: 1700000000,
            cpu_usage: 12.5,
            memory_usage: 45.2,
            active_connections: 150,
            requests_per_second: 320.0,
            active_release_id: 42,
            version: "v1.0.0".into(),
            role: "dataplane".into(),
            metrics_scope: "container".into(),
            hostname: "test-host".into(),
            runtime_started_at: 1699999000,
            worker_identity: "worker-0".into(),
            metrics_available: true,
        };

        let bytes = payload.to_protobuf_bytes();
        assert!(!bytes.is_empty());
        // Verify node_id is in bytes
        assert!(bytes.windows("node-test-01".len()).any(|w| w == b"node-test-01"));
        assert!(bytes.windows("test-host".len()).any(|w| w == b"test-host"));
    }
}
