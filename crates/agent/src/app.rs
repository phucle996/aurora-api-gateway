use crate::config::Config;
use crate::grpc::GrpcClient;
use crate::metrics;
use crate::nginx::NginxManager;
use crate::sync;
use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

pub struct App {
    pub cfg: Arc<Config>,
    pub nginx: Arc<NginxManager>,
    pub grpc_client: GrpcClient,
    pub started_at: i64,
}

impl App {
    pub async fn new(cfg: Arc<Config>) -> Result<Self> {
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        info!(
            node_id = %cfg.node_id,
            controller = %cfg.controller_url,
            "Initializing Aurora Dataplane Agent"
        );

        // 1. Ensure essential directories exist
        tokio::fs::create_dir_all(&cfg.policy_dir).await?;
        tokio::fs::create_dir_all(&cfg.routing_dir).await?;

        // 2. Initialize default policy and access snapshots
        let default_policy = cfg.policy_dir.join("active-policy.json");
        let should_init_policy = match tokio::fs::read_to_string(&default_policy).await {
            Ok(c) => !c.contains("\"schema_version\""),
            Err(_) => true,
        };
        if should_init_policy {
            let initial_json = r#"{"schema_version":1,"block_paths":["/blocked","/__aurora_blocked"]}"#;
            let _ = tokio::fs::write(&default_policy, initial_json).await;
        }

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

        // 3. Initialize NGINX Manager
        let nginx = NginxManager::new(cfg.nginx_bin.clone(), cfg.nginx_conf.clone());
        if !cfg.no_nginx {
            nginx.start().await.map_err(|e| {
                error!("Failed to start NGINX child process: {}", e);
                e
            })?;
        }

        // 4. Initialize gRPC Client
        let grpc_endpoint = cfg.grpc_endpoint();
        info!(grpc_endpoint = %grpc_endpoint, "Connecting to Control Plane via gRPC");
        let grpc_client = GrpcClient::new(&grpc_endpoint, &cfg.auth_token)?;

        Ok(Self {
            cfg,
            nginx,
            grpc_client,
            started_at,
        })
    }

    pub async fn run(self: Arc<Self>, shutdown: CancellationToken) -> Result<()> {
        info!("Starting Aurora Dataplane Agent background sync workers");

        // Spawn background sync loops
        let c1 = self.cfg.clone();
        let n1 = self.nginx.clone();
        let cl1 = self.grpc_client.clone();
        let started_at = self.started_at;
        tokio::spawn(async move {
            sync::heartbeat::run_heartbeat_loop(c1, cl1, n1, started_at).await;
        });

        let c2 = self.cfg.clone();
        let n2 = self.nginx.clone();
        let cl2 = self.grpc_client.clone();
        tokio::spawn(async move {
            sync::policy::run_policy_sync_loop(c2, cl2, n2).await;
        });

        let c3 = self.cfg.clone();
        let n3 = self.nginx.clone();
        let cl3 = self.grpc_client.clone();
        tokio::spawn(async move {
            sync::routing::run_routing_sync_loop(c3, cl3, n3).await;
        });

        let c4 = self.cfg.clone();
        let n4 = self.nginx.clone();
        let cl4 = self.grpc_client.clone();
        tokio::spawn(async move {
            sync::modules::run_modules_sync_loop(c4, cl4, n4).await;
        });

        // Initialize Metrics Manager with pull and push exporters
        let node_id_arc = Arc::new(self.cfg.node_id.clone());
        let metrics_port = self.cfg.metrics_port;
        let prometheus_enabled = self.cfg.metrics_prometheus;
        let otlp_endpoint = self.cfg.metrics_otlp_endpoint.clone().unwrap_or_default();
        let otlp_enabled = !otlp_endpoint.trim().is_empty();
        let otlp_interval = self.cfg.metrics_otlp_interval_secs;
        let metrics_shutdown = shutdown.clone();

        let stub_status_url = self.cfg.nginx_stub_status_url.clone();
        tokio::spawn(async move {
            let manager = metrics::MetricsManager::new(stub_status_url)
                .with_pull_exporter(Arc::new(metrics::PrometheusExporter::new(prometheus_enabled)))
                .with_push_exporter(Arc::new(metrics::OtlpExporter::new(otlp_enabled, otlp_endpoint, otlp_interval)));

            manager.run(metrics_port, node_id_arc, metrics_shutdown).await;
        });

        // Spawn Watchdog loop
        if !self.cfg.no_nginx {
            let n_watch = self.nginx.clone();
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

        // Wait for shutdown signal
        shutdown.cancelled().await;

        info!("Shutdown signal received. Stopping Aurora Dataplane Agent...");
        if !self.cfg.no_nginx {
            self.nginx.stop().await;
        }

        info!("Aurora Dataplane Agent shutdown complete");
        Ok(())
    }
}
