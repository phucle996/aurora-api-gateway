use crate::config::Config;
use crate::nginx::NginxManager;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::fs;
use tracing::{error, info};

#[derive(Deserialize, Debug)]
struct PolicySyncResponse {
    release_id: i64,
    #[allow(dead_code)]
    digest: Option<String>,
    payload: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
struct UpstreamSyncResponse {
    release_id: i64,
    #[allow(dead_code)]
    digest: Option<String>,
    config_content: Option<String>,
}

#[derive(Serialize, Debug)]
struct PolicyReportRequest<'a> {
    release_id: i64,
    phase: &'a str,
    message: &'a str,
}

pub async fn run_policy_sync_loop(
    cfg: Arc<Config>,
    client: Client,
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
        let url_policy = format!("{}/api/v1/policy-sync/{}", cfg.controller_url, cfg.node_id);
        if let Some(rel_id) = sync_policy_endpoint(&client, &url_policy, &cfg.auth_token, &policy_path, "WAF policy").await {
            changed = true;
            applied_policy_release = Some((url_policy, rel_id));
        }

        // 2. Access Policy Sync
        let url_access = format!("{}/api/v1/access-sync/{}", cfg.controller_url, cfg.node_id);
        if let Some(rel_id) = sync_policy_endpoint(&client, &url_access, &cfg.auth_token, &access_path, "Access policy").await {
            changed = true;
            applied_access_release = Some((url_access, rel_id));
        }

        // 3. Upstream Config Sync
        let url_upstreams = format!("{}/api/v1/upstream-sync/{}", cfg.controller_url, cfg.node_id);
        if let Some(rel_id) = sync_upstream_endpoint(&client, &url_upstreams, &cfg.auth_token, &upstreams_path).await {
            changed = true;
            if rel_id > 0 {
                applied_upstream_release = Some((url_upstreams, rel_id));
            }
        }

        // 4. Reload NGINX and report phase back to Controller
        if changed && !cfg.no_nginx {
            let reload_res = nginx.reload().await;
            match reload_res {
                Ok(_) => {
                    info!("NGINX reloaded successfully after policy/upstream updates");
                    if let Some((url, rel_id)) = applied_policy_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "applied", "WAF policy applied").await;
                    }
                    if let Some((url, rel_id)) = applied_access_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "applied", "Access policy applied").await;
                    }
                    if let Some((url, rel_id)) = applied_upstream_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "applied", "Upstreams applied").await;
                    }
                }
                Err(e) => {
                    error!("Failed to reload NGINX after policy updates: {}", e);
                    let err_msg = e.to_string();
                    if let Some((url, rel_id)) = applied_policy_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "failed", &err_msg).await;
                    }
                    if let Some((url, rel_id)) = applied_access_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "failed", &err_msg).await;
                    }
                    if let Some((url, rel_id)) = applied_upstream_release {
                        report_phase(&client, &url, &cfg.auth_token, rel_id, "failed", &err_msg).await;
                    }
                }
            }
        }
    }
}

async fn sync_policy_endpoint(
    client: &Client,
    url: &str,
    token: &str,
    target: &Path,
    desc: &str,
) -> Option<i64> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let sync_res: PolicySyncResponse = resp.json().await.ok()?;
    if sync_res.release_id <= 0 || sync_res.payload.is_none() {
        return None;
    }

    let payload_val = sync_res.payload.as_ref().unwrap();
    let content = serde_json::to_string_pretty(payload_val).ok()?;

    let should_write = match fs::read_to_string(target).await {
        Ok(old) => old != content,
        Err(_) => true,
    };

    if should_write && fs::write(target, &content).await.is_ok() {
        info!("Updated {} snapshot (release {})", desc, sync_res.release_id);
        Some(sync_res.release_id)
    } else {
        None
    }
}

async fn sync_upstream_endpoint(
    client: &Client,
    url: &str,
    token: &str,
    target: &Path,
) -> Option<i64> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let sync_res: UpstreamSyncResponse = resp.json().await.ok()?;
    let config = sync_res.config_content.unwrap_or_default();
    if config.trim().is_empty() {
        return None;
    }

    let should_write = match fs::read_to_string(target).await {
        Ok(old) => old != config,
        Err(_) => true,
    };

    if should_write && fs::write(target, &config).await.is_ok() {
        info!("Updated active-upstreams.conf snapshot");
        Some(sync_res.release_id)
    } else {
        None
    }
}

async fn report_phase(
    client: &Client,
    url: &str,
    token: &str,
    release_id: i64,
    phase: &str,
    message: &str,
) {
    let req = PolicyReportRequest {
        release_id,
        phase,
        message,
    };
    let _ = client
        .post(url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&req)
        .send()
        .await;
}
