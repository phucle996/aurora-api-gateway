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
                if let Err(err) = self.materialize_and_activate(&spec).await {
                    error!(error = %err, "Failed to activate baseline NodeSpec; keeping it out of sync");
                    return;
                }
                if let Err(err) = self
                    .dispatcher
                    .lock()
                    .await
                    .apply_spec(&spec.extensions)
                    .await
                {
                    error!(error = %err, "Failed to activate baseline extension runtime");
                    return;
                }
                *self.current_hash.lock().await = hash;
            } else {
                warn!("Failed to parse local node-spec.yaml, will wait for Controller sync");
            }
        }
    }

    // This is deliberately shared by bootstrap and sync. Both paths own the same
    // invariant: a spec hash becomes current only after its NGINX configuration is live.
    async fn materialize_and_activate(&self, spec: &Spec) -> Result<(), String> {
        let result = materialize_nginx(spec, &self.cfg.policy_dir, &self.cfg.routing_dir)
            .await
            .map_err(|err| format!("failed to materialize NGINX configs from NodeSpec: {err}"))?;

        if result.nginx_changed && !self.cfg.no_nginx {
            self.nginx
                .test_config(&self.cfg.nginx_conf)
                .await
                .map_err(|err| format!("NGINX config test failed after spec update: {err}"))?;
            self.nginx
                .reload()
                .await
                .map_err(|err| format!("failed to reload NGINX after spec update: {err}"))?;
            info!("NGINX reloaded successfully with new NodeSpec");
        }

        Ok(())
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

        // 2. Materialize and activate NGINX before acknowledging the new hash.
        self.materialize_and_activate(&spec).await?;

        // 3. Dispatch & Hot-reload Extensions
        self.dispatcher
            .lock()
            .await
            .apply_spec(&spec.extensions)
            .await
            .map_err(|error| format!("failed to activate extension runtime: {error}"))?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn failed_nginx_activation_does_not_advance_the_spec_hash() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after unix epoch")
            .as_nanos();
        let base = std::env::temp_dir().join(format!("aurora-agent-spec-sync-{unique}"));
        let policy_dir = base.join("policy");
        let routing_dir = base.join("routing");
        let modules_dir = base.join("modules");
        fs::create_dir_all(&policy_dir).expect("create policy directory");
        fs::create_dir_all(&routing_dir).expect("create routing directory");
        fs::create_dir_all(&modules_dir).expect("create modules directory");

        let nginx_bin = base.join("nginx-fails");
        fs::write(&nginx_bin, "#!/bin/sh\nexit 1\n").expect("write fake nginx");
        let mut permissions = fs::metadata(&nginx_bin)
            .expect("read fake nginx permissions")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&nginx_bin, permissions).expect("make fake nginx executable");

        let cfg = Config {
            controller_url: "http://127.0.0.1:8080".to_string(),
            node_id: "node-test".to_string(),
            auth_token: "test-token".to_string(),
            nginx_bin: nginx_bin.clone(),
            nginx_conf: base.join("nginx.conf"),
            policy_dir,
            routing_dir,
            modules_dir,
            heartbeat_interval_secs: 5,
            sync_interval_secs: 3,
            metrics_port: 9145,
            metrics_prometheus: false,
            metrics_otlp_endpoint: None,
            metrics_otlp_interval_secs: 15,
            nginx_stub_status_url: None,
            no_nginx: false,
            grpc_url: None,
        };
        let nginx = NginxManager::new(nginx_bin, cfg.nginx_conf.clone());
        let dispatcher = Arc::new(Mutex::new(ExtensionDispatcher::new(Arc::new(
            cfg.node_id.clone(),
        ))));
        let grpc = GrpcClient::new("http://127.0.0.1:9090", "test-token")
            .expect("create lazy grpc client");
        let runner = SpecSyncRunner::new(cfg, nginx, dispatcher, grpc);

        let body = "version: 1\nrelease_id: 7\n";
        let err = runner
            .apply_spec_content(body, &compute_sha256(body.as_bytes()))
            .await
            .expect_err("failed nginx config test must reject the spec");

        assert!(err.contains("NGINX config test failed"));
        assert!(runner.current_hash.lock().await.is_empty());

        fs::remove_dir_all(base).expect("remove temporary test directory");
    }
}
