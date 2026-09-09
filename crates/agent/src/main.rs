mod app;
mod config;
mod grpc;
mod metrics;
mod nginx;
mod sync;

use anyhow::Result;
use app::App;
use config::Config;
use std::sync::Arc;
use tokio::signal;
use tokio_util::sync::CancellationToken;
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

    // 2. Load Configuration
    let cfg = Arc::new(Config::load());

    // 3. Initialize Application Composition Root
    let app = Arc::new(App::new(cfg).await?);

    // 4. Setup Graceful Shutdown Signal Handler
    let shutdown = CancellationToken::new();
    let shutdown_trigger = shutdown.clone();

    tokio::spawn(async move {
        wait_for_shutdown_signal().await;
        shutdown_trigger.cancel();
    });

    // 5. Run Application until shutdown
    app.run(shutdown).await
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
