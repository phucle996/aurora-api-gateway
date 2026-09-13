use anyhow::Result;
use aurora_agent::{App, Config};
use std::sync::Arc;
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--materialize-l4" {
        let input = if args.len() > 2 && !args[2].is_empty() {
            std::fs::read_to_string(&args[2])?
        } else {
            use std::io::Read;
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf)?;
            buf
        };

        let l4_spec: aurora_agent::spec::l4::L4Spec =
            if let Ok(spec) = aurora_agent::spec::schema::Spec::parse_json(&input) {
                spec.l4.unwrap_or_default()
            } else {
                serde_json::from_str(&input)
                    .map_err(|e| anyhow::anyhow!("failed to parse L4 JSON spec: {}", e))?
            };

        let conf = aurora_agent::spec::materialize::generate_l4_streams_conf(&Some(l4_spec))
            .map_err(|e| anyhow::anyhow!("failed to materialize L4 stream configuration: {}", e))?;

        if args.len() > 3 && !args[3].is_empty() {
            std::fs::write(&args[3], &conf)?;
        } else {
            print!("{}", conf);
        }
        return Ok(());
    }

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
