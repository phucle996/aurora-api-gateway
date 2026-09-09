mod config;
mod metrics;
mod nginx;
mod sync;

use anyhow::Result;
use config::Config;
use nginx::NginxManager;
use reqwest::Client;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::signal;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Setup structured logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,aurora_agent=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let started_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // 2. Load Configuration
    let cfg = Arc::new(Config::load());
    info!(
        node_id = %cfg.node_id,
        controller = %cfg.controller_url,
        "Starting Aurora Dataplane Agent"
    );

    // 3. Ensure essential directories exist
    tokio::fs::create_dir_all(&cfg.policy_dir).await?;
    tokio::fs::create_dir_all(&cfg.routing_dir).await?;

    // Initialize or heal active-policy.json
    let default_policy = cfg.policy_dir.join("active-policy.json");
    let should_init_policy = match tokio::fs::read_to_string(&default_policy).await {
        Ok(c) => !c.contains("\"schema_version\""),
        Err(_) => true,
    };
    if should_init_policy {
        let initial_json = r#"{"schema_version":1,"block_paths":["/blocked","/__aurora_blocked"]}"#;
        let _ = tokio::fs::write(&default_policy, initial_json).await;
    }

    // Initialize or heal active-access.json
    let default_access = cfg.policy_dir.join("active-access.json");
    let should_init_access = match tokio::fs::read_to_string(&default_access).await {
        Ok(c) => !c.contains("\"schema_version\""),
        Err(_) => true,
    };
    if should_init_access {
        let initial_access = r#"{"schema_version":1,"generation":0,"rules":[]}"#;
        let _ = tokio::fs::write(&default_access, initial_access).await;
    }

    let default_upstreams = cfg.policy_dir.join("active-upstreams.conf");
    if !default_upstreams.exists() {
        let _ = tokio::fs::write(&default_upstreams, "# Aurora WAF initial upstreams\n").await;
    }

    // 4. Initialize NGINX Manager
    let nginx = NginxManager::new(cfg.nginx_bin.clone(), cfg.nginx_conf.clone());

    if !cfg.no_nginx {
        nginx.start().await.map_err(|e| {
            error!("Failed to start NGINX child process: {}", e);
            e
        })?;
    }

    // 5. HTTP Client for Control Plane communication
    let http_client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    // 6. Spawn Background Sync & Telemetry Loops
    let c1 = cfg.clone();
    let n1 = nginx.clone();
    let cl1 = http_client.clone();
    tokio::spawn(async move {
        sync::heartbeat::run_heartbeat_loop(c1, cl1, n1, started_at).await;
    });

    let c2 = cfg.clone();
    let n2 = nginx.clone();
    let cl2 = http_client.clone();
    tokio::spawn(async move {
        sync::policy::run_policy_sync_loop(c2, cl2, n2).await;
    });

    let c3 = cfg.clone();
    let n3 = nginx.clone();
    let cl3 = http_client.clone();
    tokio::spawn(async move {
        sync::routing::run_routing_sync_loop(c3, cl3, n3).await;
    });

    let c4 = cfg.clone();
    let n4 = nginx.clone();
    let cl4 = http_client.clone();
    tokio::spawn(async move {
        sync::modules::run_modules_sync_loop(c4, cl4, n4).await;
    });

    let node_id_arc = Arc::new(cfg.node_id.clone());
    let metrics_port = cfg.metrics_port;
    tokio::spawn(async move {
        metrics::run_metrics_server(metrics_port, node_id_arc).await;
    });

    // 7. Watchdog Loop: if NGINX crashes, restart it
    if !cfg.no_nginx {
        let n_watch = nginx.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Some(status) = n_watch.wait_or_check().await {
                    error!("NGINX process exited unexpectedly with: {:?}. Restarting...", status);
                    if let Err(e) = n_watch.start().await {
                        error!("Failed to restart NGINX: {}", e);
                    }
                }
            }
        });
    }

    // 8. Wait for OS Termination Signal
    wait_for_shutdown_signal().await;
    info!("Shutdown signal received. Stopping Aurora Dataplane Agent...");

    if !cfg.no_nginx {
        nginx.stop().await;
    }

    info!("Aurora Dataplane Agent terminated gracefully.");
    Ok(())
}

async fn wait_for_shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
