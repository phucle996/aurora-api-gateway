use crate::config::Config;
use crate::extension::ExtensionDispatcher;
use crate::grpc::GrpcClient;
use crate::logs::{LogBus, LogShmHandle};
use crate::nginx::NginxManager;
use crate::sync;
use anyhow::Result;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

pub struct App {
    pub cfg: Arc<Config>,
    pub nginx: Arc<NginxManager>,
    pub grpc_client: GrpcClient,
    pub log_bus: Option<Arc<LogBus>>,
    pub started_at: i64,
}

impl App {
    pub async fn new(cfg: Arc<Config>) -> Result<Self> {
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        info!(
            hostname = %cfg.hostname(),
            controller = %cfg.controller_url,
            "Initializing Aurora Dataplane Agent"
        );

        // 1. Ensure essential directories exist
        tokio::fs::create_dir_all(&cfg.policy_dir).await?;
        tokio::fs::create_dir_all(&cfg.routing_dir).await?;

        // 2. Initialize default upstreams
        let default_upstreams = cfg.policy_dir.join("active-upstreams.conf");
        if !default_upstreams.exists() {
            let _ = tokio::fs::write(
                &default_upstreams,
                "# Aurora API Gateway initial upstreams\n",
            )
            .await;
        }

        // 3. Initialize high-performance LogBus
        let shm_handle = LogShmHandle::open_or_create().map(Arc::new);
        let log_bus = match LogBus::bind(None, shm_handle) {
            Ok(bus) => {
                info!(
                    path = %bus.socket_path().display(),
                    "Initialized LogBus Unix datagram socket"
                );
                Some(Arc::new(bus))
            }
            Err(e) => {
                warn!("Failed to bind LogBus Unix datagram socket: {e}");
                None
            }
        };

        // 4. Initialize Gateway Manager (syntax test & reload only)
        let nginx = NginxManager::new(cfg.gateway_bin.clone(), cfg.gateway_conf.clone());

        // 5. Initialize gRPC Client
        let grpc_endpoint = cfg.grpc_endpoint();
        info!(
            grpc_endpoint = %grpc_endpoint,
            grpc_tls_mode = ?cfg.grpc_tls_mode,
            "Connecting to Control Plane via gRPC"
        );
        let grpc_client = GrpcClient::new(&cfg)?;

        Ok(Self {
            cfg,
            nginx,
            grpc_client,
            log_bus,
            started_at,
        })
    }

    pub async fn run(self: Arc<Self>, shutdown: CancellationToken) -> Result<()> {
        info!("Starting Aurora Dataplane Agent background sync workers");

        // Initialize Extension Dispatcher
        let dispatcher = Arc::new(Mutex::new(ExtensionDispatcher::new(
            Arc::new(self.cfg.hostname.clone()),
            self.log_bus.clone(),
        )));

        // Spawn Unified SpecSync runner
        let spec_sync = Arc::new(sync::spec::SpecSyncRunner::new(
            (*self.cfg).clone(),
            self.nginx.clone(),
            dispatcher.clone(),
            self.grpc_client.clone(),
        ));
        let spec_shutdown = shutdown.clone();
        tokio::spawn(async move {
            spec_sync.run(spec_shutdown).await;
        });

        // Wait for shutdown signal
        shutdown.cancelled().await;

        info!("Shutdown signal received. Stopping Aurora Dataplane Agent...");
        dispatcher.lock().await.shutdown_all().await;

        info!("Aurora Dataplane Agent shutdown complete");
        Ok(())
    }
}
