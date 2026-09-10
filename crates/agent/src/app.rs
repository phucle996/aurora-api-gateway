use crate::config::Config;
use crate::extension::ExtensionDispatcher;
use crate::grpc::GrpcClient;
use crate::nginx::NginxManager;
use crate::sync;
use anyhow::Result;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
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
            let initial_json =
                r#"{"schema_version":1,"block_paths":["/blocked","/__aurora_blocked"]}"#;
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
            let _ = tokio::fs::write(&default_upstreams, "# Aurora API Gateway initial upstreams\n").await;
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

        // Initialize Extension Dispatcher
        let dispatcher = Arc::new(Mutex::new(ExtensionDispatcher::new(Arc::new(
            self.cfg.node_id.clone(),
        ))));

        // Baseline initialization from CLI flags (if any) until first spec sync
        let initial_spec = crate::spec::extensions::ExtensionsSpec {
            prometheus: Some(crate::spec::extensions::MetricsExtensionSpec {
                enabled: self.cfg.metrics_prometheus || self.cfg.metrics_otlp_endpoint.is_some(),
                port: self.cfg.metrics_port,
                stub_status_url: self.cfg.nginx_stub_status_url.clone(),
                prometheus: Some(crate::spec::extensions::PrometheusSpec {
                    enabled: self.cfg.metrics_prometheus,
                    path: "/metrics".to_string(),
                }),
                otlp: self
                    .cfg
                    .metrics_otlp_endpoint
                    .as_ref()
                    .map(|ep| crate::spec::extensions::OtlpSpec {
                        enabled: true,
                        endpoint: ep.clone(),
                        interval_secs: self.cfg.metrics_otlp_interval_secs,
                    }),
            }),
            ..Default::default()
        };
        dispatcher.lock().await.apply_spec(&initial_spec).await;

        // Spawn Unified SpecSync runner
        let spec_sync = Arc::new(sync::spec::SpecSyncRunner::new(
            (*self.cfg).clone(),
            self.nginx.clone(),
            dispatcher.clone(),
            Some(self.grpc_client.clone()),
        ));
        let spec_shutdown = shutdown.clone();
        tokio::spawn(async move {
            spec_sync.run(spec_shutdown).await;
        });

        // Spawn Watchdog loop
        if !self.cfg.no_nginx {
            let n_watch = self.nginx.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    if let Some(status) = n_watch.wait_or_check().await {
                        error!(
                            "NGINX process exited unexpectedly with: {:?}. Restarting...",
                            status
                        );
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
        dispatcher.lock().await.shutdown_all().await;
        if !self.cfg.no_nginx {
            self.nginx.stop().await;
        }

        info!("Aurora Dataplane Agent shutdown complete");
        Ok(())
    }
}
