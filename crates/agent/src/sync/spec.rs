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
    grpc: GrpcClient,
    spec_path: PathBuf,
    current_hash: Arc<Mutex<String>>,
}

impl SpecSyncRunner {
    pub fn new(
        cfg: Config,
        nginx: Arc<NginxManager>,
        dispatcher: Arc<Mutex<ExtensionDispatcher>>,
        grpc: GrpcClient,
    ) -> Self {
        let spec_path = cfg.policy_dir.join("node-spec.yaml");
        Self {
            cfg,
            nginx,
            dispatcher,
            grpc,
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
                if let Ok(res) =
                    materialize_nginx(&spec, &self.cfg.policy_dir, &self.cfg.routing_dir).await
                {
                    if res.nginx_changed && !self.cfg.no_nginx {
                        if let Err(err) = self.nginx.test_config(&self.cfg.nginx_conf).await {
                            error!(error = %err, "NGINX config test failed on bootstrap! Skipping reload");
                        } else if let Err(err) = self.nginx.reload().await {
                            error!(error = %err, "Failed to reload NGINX on bootstrap");
                        } else {
                            info!("NGINX reloaded successfully on bootstrap");
                        }
                    }
                }
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

    /// Single sync cycle: Pure gRPC spec sync, no HTTP fallback.
    pub async fn sync_once(&self) {
        let local_hash = self.current_hash.lock().await.clone();

        let handler = self.grpc.spec_handler();
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
            }
            Err(e) => {
                debug!(error = %e, "gRPC sync_spec failed (offline / retrying)");
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
