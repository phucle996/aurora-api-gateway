use crate::config::Config;
use crate::grpc::GrpcClient;
use crate::nginx::NginxManager;
use std::path::Path;
use std::sync::Arc;
use tokio::fs;
use tracing::{error, info};

pub async fn run_policy_sync_loop(
    cfg: Arc<Config>,
    client: GrpcClient,
    nginx: Arc<NginxManager>,
) {
    let interval = tokio::time::Duration::from_secs(cfg.sync_interval_secs);
    let mut ticker = tokio::time::interval(interval);

    let policy_path = cfg.policy_dir.join("active-policy.json");
    let access_path = cfg.policy_dir.join("active-access.json");
    let upstreams_path = cfg.policy_dir.join("active-upstreams.conf");

    let _ = fs::create_dir_all(&cfg.policy_dir).await;

    loop {
        ticker.tick().await;

        let mut changed = false;
        let mut applied_policy_release = None;
        let mut applied_access_release = None;
        let mut applied_upstream_release = None;

        // 1. WAF Policy Sync
        if let Ok(data) = client.get_policy(&cfg.node_id).await {
            if data.release_id > 0 && !data.payload_json.is_empty() {
                if sync_file(&policy_path, &data.payload_json, "WAF policy", data.release_id).await {
                    changed = true;
                    applied_policy_release = Some(data.release_id);
                }
            }
        }

        // 2. Access Policy Sync
        if let Ok(data) = client.get_access(&cfg.node_id).await {
            if data.release_id > 0 && !data.payload_json.is_empty() {
                if sync_file(&access_path, &data.payload_json, "Access policy", data.release_id).await {
                    changed = true;
                    applied_access_release = Some(data.release_id);
                }
            }
        }

        // 3. Upstream Config Sync
        if let Ok(data) = client.get_upstreams(&cfg.node_id).await {
            if data.release_id > 0 && !data.config_content.is_empty() {
                if sync_file(&upstreams_path, &data.config_content, "Upstreams", data.release_id).await {
                    changed = true;
                    applied_upstream_release = Some(data.release_id);
                }
            }
        }

        // 4. Reload NGINX and report phase back to Controller
        if changed && !cfg.no_nginx {
            let reload_res = nginx.reload().await;
            match reload_res {
                Ok(_) => {
                    info!("NGINX reloaded successfully after policy/upstream updates");
                    if let Some(rel_id) = applied_policy_release {
                        let _ = client
                            .report_policy(&cfg.node_id, rel_id, "applied", "WAF policy applied")
                            .await;
                    }
                    if let Some(rel_id) = applied_access_release {
                        let _ = client
                            .report_access(&cfg.node_id, rel_id, "applied", "Access policy applied")
                            .await;
                    }
                    if let Some(rel_id) = applied_upstream_release {
                        let _ = client
                            .report_upstreams(&cfg.node_id, rel_id, "applied", "Upstreams applied")
                            .await;
                    }
                }
                Err(e) => {
                    error!("Failed to reload NGINX after policy updates: {}", e);
                    let err_msg = e.to_string();
                    if let Some(rel_id) = applied_policy_release {
                        let _ = client
                            .report_policy(&cfg.node_id, rel_id, "failed", &err_msg)
                            .await;
                    }
                    if let Some(rel_id) = applied_access_release {
                        let _ = client
                            .report_access(&cfg.node_id, rel_id, "failed", &err_msg)
                            .await;
                    }
                    if let Some(rel_id) = applied_upstream_release {
                        let _ = client
                            .report_upstreams(&cfg.node_id, rel_id, "failed", &err_msg)
                            .await;
                    }
                }
            }
        }
    }
}

async fn sync_file(target: &Path, content: &str, desc: &str, release_id: i64) -> bool {
    let should_write = match fs::read_to_string(target).await {
        Ok(old) => old != content,
        Err(_) => true,
    };

    if should_write && fs::write(target, content).await.is_ok() {
        info!("Updated {} snapshot (release {})", desc, release_id);
        true
    } else {
        false
    }
}
