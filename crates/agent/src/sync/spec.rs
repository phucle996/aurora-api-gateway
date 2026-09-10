use crate::config::Config;
use crate::extension::ExtensionDispatcher;
use crate::grpc::GrpcClient;
use crate::nginx::NginxManager;
use crate::spec::materialize::materialize_nginx;
use crate::spec::schema::{Spec, compute_sha256};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

pub struct SpecSyncRunner {
    cfg: Config,
    nginx: Arc<NginxManager>,
    dispatcher: Arc<Mutex<ExtensionDispatcher>>,
    grpc: Option<GrpcClient>,
    client: reqwest::Client,
    spec_path: PathBuf,
    current_hash: Arc<Mutex<String>>,
}

impl SpecSyncRunner {
    pub fn new(
        cfg: Config,
        nginx: Arc<NginxManager>,
        dispatcher: Arc<Mutex<ExtensionDispatcher>>,
        grpc: Option<GrpcClient>,
    ) -> Self {
        let spec_path = cfg.policy_dir.join("node-spec.yaml");
        Self {
            cfg,
            nginx,
            dispatcher,
            grpc,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
            spec_path,
            current_hash: Arc::new(Mutex::new(String::new())),
        }
    }

    /// Bootstrap from existing local node-spec.yaml on disk if present.
    pub async fn bootstrap(&self) {
        if self.spec_path.exists()
            && let Ok(raw) = tokio::fs::read_to_string(&self.spec_path).await
        {
            let hash = compute_sha256(raw.as_bytes());
            info!(hash = %hash, path = %self.spec_path.display(), "Loading baseline node-spec.yaml from disk");
            if let Ok(spec) = Spec::parse_yaml(&raw) {
                let _ = materialize_nginx(&spec, &self.cfg.policy_dir, &self.cfg.routing_dir).await;
                self.dispatcher
                    .lock()
                    .await
                    .apply_spec(&spec.extensions)
                    .await;
                *self.current_hash.lock().await = hash;
            } else {
                warn!("Failed to parse local node-spec.yaml, will wait for Controller sync");
            }
        }
    }

    /// Apply and materialize new YAML specification content safely (Fault-tolerant / Never-crash).
    async fn apply_spec_content(&self, body: &str, expected_hash: &str) -> Result<i64, String> {
        let calculated_hash = compute_sha256(body.as_bytes());
        if !expected_hash.is_empty() && calculated_hash != expected_hash {
            return Err(format!(
                "Checksum mismatch: expected {}, got {}",
                expected_hash, calculated_hash
            ));
        }

        let spec = Spec::parse_yaml(body).map_err(|e| format!("YAML parse error: {}", e))?;

        // 1. Write atomic node-spec.yaml
        let tmp_path = self
            .spec_path
            .with_extension(format!("tmp.{}", std::process::id()));
        tokio::fs::write(&tmp_path, body.as_bytes())
            .await
            .map_err(|e| format!("Failed to write temp spec: {}", e))?;
        tokio::fs::rename(&tmp_path, &self.spec_path)
            .await
            .map_err(|e| format!("Failed to commit node-spec.yaml: {}", e))?;

        // 2. Materialize NGINX configurations
        match materialize_nginx(&spec, &self.cfg.policy_dir, &self.cfg.routing_dir).await {
            Ok(res) => {
                if res.nginx_changed && !self.cfg.no_nginx {
                    if let Err(err) = self.nginx.test_config(&self.cfg.nginx_conf).await {
                        error!(error = %err, "NGINX config test failed after spec update! Skipping reload");
                    } else if let Err(err) = self.nginx.reload().await {
                        error!(error = %err, "Failed to reload NGINX after spec update");
                    } else {
                        info!("NGINX reloaded successfully with new NodeSpec");
                    }
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to materialize NGINX configs from NodeSpec");
            }
        }

        // 3. Dispatch & Hot-reload Extensions
        self.dispatcher
            .lock()
            .await
            .apply_spec(&spec.extensions)
            .await;

        // 4. Update local hash
        *self.current_hash.lock().await = calculated_hash.clone();
        info!(
            hash = %calculated_hash,
            release_id = spec.release_id,
            "Applied new NodeSpec successfully"
        );

        Ok(spec.release_id as i64)
    }

    /// Single sync cycle: Try gRPC first, fallback to HTTP.
    pub async fn sync_once(&self) {
        let local_hash = self.current_hash.lock().await.clone();

        // 1. Try gRPC Sync
        if let Some(ref grpc) = self.grpc {
            let handler = grpc.spec_handler();
            match handler.sync_spec(&self.cfg.node_id, &local_hash).await {
                Ok(res) => {
                    if res.in_sync {
                        debug!(hash = %local_hash, "NodeSpec is in sync via gRPC");
                        return;
                    }

                    match self.apply_spec_content(&res.spec_yaml, &res.hash).await {
                        Ok(release_id) => {
                            let _ = handler
                                .report_spec(
                                    &self.cfg.node_id,
                                    release_id,
                                    &res.hash,
                                    "in_sync",
                                    "NodeSpec applied cleanly",
                                )
                                .await;
                        }
                        Err(err) => {
                            error!(error = %err, "Failed to apply NodeSpec from gRPC");
                            let _ = handler
                                .report_spec(
                                    &self.cfg.node_id,
                                    res.release_id,
                                    &res.hash,
                                    "out_of_sync",
                                    &err,
                                )
                                .await;
                        }
                    }
                    return;
                }
                Err(e) => {
                    debug!(error = %e, "gRPC sync_spec unavailable, attempting HTTP probe");
                }
            }
        }

        // 2. HTTP Fallback
        let url = format!(
            "{}/api/v1/sync/spec",
            self.cfg.controller_url.trim_end_matches('/')
        );

        let resp = match self
            .client
            .get(&url)
            .query(&[
                ("node_id", &self.cfg.node_id),
                ("current_hash", &local_hash),
            ])
            .header("Authorization", format!("Bearer {}", self.cfg.auth_token))
            .header("X-Aurora-Node", &self.cfg.node_id)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                debug!(error = %e, "Unified spec sync HTTP probe failed (offline / retrying)");
                return;
            }
        };

        match resp.status() {
            reqwest::StatusCode::NOT_MODIFIED => {
                debug!(hash = %local_hash, "NodeSpec is up to date via HTTP (304 Not Modified)");
            }
            reqwest::StatusCode::OK => {
                let hash_header = resp
                    .headers()
                    .get("X-Aurora-Spec-Hash")
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or_default()
                    .to_string();

                let body = match resp.text().await {
                    Ok(b) => b,
                    Err(e) => {
                        error!(error = %e, "Failed to read NodeSpec HTTP response body");
                        return;
                    }
                };

                if let Err(err) = self.apply_spec_content(&body, &hash_header).await {
                    error!(error = %err, "Failed to apply NodeSpec from HTTP");
                }
            }
            status => {
                debug!(status = %status, "Controller returned non-200 status for HTTP spec sync probe");
            }
        }
    }

    /// Background loop running unified spec sync.
    pub async fn run(self: Arc<Self>, shutdown: CancellationToken) {
        self.bootstrap().await;

        let interval = Duration::from_secs(self.cfg.sync_interval_secs);
        loop {
            tokio::select! {
                _ = shutdown.cancelled() => {
                    info!("Unified SpecSync runner exiting");
                    break;
                }
                _ = tokio::time::sleep(interval) => {
                    self.sync_once().await;
                }
            }
        }
    }
}
