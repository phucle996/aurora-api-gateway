use crate::config::Config;
use crate::extension::ExtensionDispatcher;
use crate::nginx::NginxManager;
use crate::spec::materialize::materialize_nginx;
use crate::spec::{compute_sha256, NodeSpec};
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
    client: reqwest::Client,
    spec_path: PathBuf,
    current_hash: Arc<Mutex<String>>,
}

impl SpecSyncRunner {
    pub fn new(
        cfg: Config,
        nginx: Arc<NginxManager>,
        dispatcher: Arc<Mutex<ExtensionDispatcher>>,
    ) -> Self {
        let spec_path = cfg.policy_dir.join("node-spec.yaml");
        Self {
            cfg,
            nginx,
            dispatcher,
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
            if let Ok(spec) = NodeSpec::parse_yaml(&raw) {
                let _ = materialize_nginx(&spec, &self.cfg.policy_dir, &self.cfg.routing_dir).await;
                self.dispatcher.lock().await.apply_spec(&spec.extensions).await;
                *self.current_hash.lock().await = hash;
            } else {
                warn!("Failed to parse local node-spec.yaml, will wait for Controller sync");
            }
        }
    }

    /// Single sync cycle: Send current SHA-256 hash to Controller.
    /// Controller compares hash; returns 304 if unchanged, or 200 with full YAML if updated.
    pub async fn sync_once(&self) {
        let local_hash = self.current_hash.lock().await.clone();
        let url = format!(
            "{}/api/v1/sync/spec",
            self.cfg.controller_url.trim_end_matches('/')
        );

        let resp = match self
            .client
            .get(&url)
            .query(&[("node_id", &self.cfg.node_id), ("current_hash", &local_hash)])
            .header("Authorization", format!("Bearer {}", self.cfg.auth_token))
            .header("X-Aurora-Node", &self.cfg.node_id)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                debug!(error = %e, "Unified spec sync probe to Controller failed (offline / retrying)");
                return;
            }
        };

        match resp.status() {
            reqwest::StatusCode::NOT_MODIFIED => {
                // 304: Controller confirms our local spec is up to date (0 bytes payload overhead)
                debug!(hash = %local_hash, "NodeSpec is up to date (304 Not Modified)");
            }
            reqwest::StatusCode::OK => {
                let body = match resp.text().await {
                    Ok(b) => b,
                    Err(e) => {
                        error!(error = %e, "Failed to read NodeSpec response body");
                        return;
                    }
                };

                let new_hash = compute_sha256(body.as_bytes());
                if new_hash == local_hash {
                    debug!("Received identical NodeSpec content");
                    return;
                }

                let spec = match NodeSpec::parse_yaml(&body) {
                    Ok(s) => s,
                    Err(e) => {
                        error!(error = %e, "Received invalid NodeSpec YAML from Controller");
                        return;
                    }
                };

                // 1. Write atomic node-spec.yaml
                let tmp_path = self.spec_path.with_extension(format!("tmp.{}", std::process::id()));
                if let Err(e) = tokio::fs::write(&tmp_path, body.as_bytes()).await {
                    error!(error = %e, "Failed to write temp node-spec.yaml");
                    return;
                }
                if let Err(e) = tokio::fs::rename(&tmp_path, &self.spec_path).await {
                    error!(error = %e, "Failed to commit node-spec.yaml to disk");
                    return;
                }

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
                self.dispatcher.lock().await.apply_spec(&spec.extensions).await;

                // 4. Update local hash
                *self.current_hash.lock().await = new_hash.clone();
                info!(
                    hash = %new_hash,
                    release_id = spec.release_id,
                    "Applied new NodeSpec successfully"
                );
            }
            status => {
                debug!(status = %status, "Controller returned non-200 status for spec sync probe");
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
