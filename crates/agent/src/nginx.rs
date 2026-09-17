use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tracing::info;

pub struct NginxManager {
    gateway_bin: PathBuf,
    gateway_conf: PathBuf,
}

impl NginxManager {
    pub fn new(gateway_bin: PathBuf, gateway_conf: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            gateway_bin,
            gateway_conf,
        })
    }

    /// Test Gateway configuration file syntax (-t -c <path>)
    pub async fn test_config(&self, conf_path: &Path) -> Result<(), String> {
        let output = Command::new(&self.gateway_bin)
            .arg("-t")
            .arg("-c")
            .arg(conf_path)
            .output()
            .await
            .map_err(|e| format!("Failed to execute gateway -t: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("gateway -t failed:\n{}{}", stdout, stderr))
        }
    }

    /// Reload Gateway configuration with zero downtime (-s reload)
    pub async fn reload(&self) -> Result<(), String> {
        info!("Sending reload signal to Gateway (-s reload)");
        let output = Command::new(&self.gateway_bin)
            .arg("-c")
            .arg(&self.gateway_conf)
            .arg("-s")
            .arg("reload")
            .output()
            .await
            .map_err(|e| format!("Failed to execute gateway -s reload: {}", e))?;

        if output.status.success() {
            info!("Gateway reload command completed successfully");
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("gateway -s reload failed: {}", stderr))
        }
    }
}
