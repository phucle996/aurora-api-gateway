use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

pub struct NginxManager {
    nginx_bin: PathBuf,
    nginx_conf: PathBuf,
    child: Mutex<Option<Child>>,
}

impl NginxManager {
    pub fn new(nginx_bin: PathBuf, nginx_conf: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            nginx_bin,
            nginx_conf,
            child: Mutex::new(None),
        })
    }

    /// Test NGINX configuration file syntax (-t -c <path>)
    pub async fn test_config(&self, conf_path: &Path) -> Result<(), String> {
        let output = Command::new(&self.nginx_bin)
            .arg("-t")
            .arg("-c")
            .arg(conf_path)
            .output()
            .await
            .map_err(|e| format!("Failed to execute nginx -t: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("nginx -t failed:\n{}{}", stdout, stderr))
        }
    }

    /// Check if the NGINX master process is currently active
    pub async fn is_running(&self) -> bool {
        let mut guard = self.child.lock().await;
        if let Some(child) = guard.as_mut() {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    }

    /// Retrieve the PID of the NGINX master process
    pub async fn master_pid(&self) -> u32 {
        let guard = self.child.lock().await;
        guard.as_ref().and_then(|c| c.id()).unwrap_or(0)
    }

    /// Query the NGINX binary version string
    pub async fn get_version(&self) -> String {
        let output = Command::new(&self.nginx_bin).arg("-v").output().await;
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stderr);
            if let Some(v) = s.lines().next() {
                return v.trim().to_string();
            }
        }
        "nginx".to_string()
    }

    /// Spawn and supervise the NGINX master process
    pub async fn start(&self) -> Result<()> {
        let mut guard = self.child.lock().await;
        if guard.is_some() {
            warn!("NGINX process is already running");
            return Ok(());
        }

        info!(
            bin = %self.nginx_bin.display(),
            conf = %self.nginx_conf.display(),
            "Starting NGINX process"
        );

        let child = Command::new(&self.nginx_bin)
            .arg("-c")
            .arg(&self.nginx_conf)
            .arg("-g")
            .arg("daemon off;")
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Failed to spawn NGINX from {:?}", self.nginx_bin))?;

        *guard = Some(child);
        info!("NGINX process started successfully");
        Ok(())
    }

    /// Reload NGINX configuration with zero downtime (-s reload)
    pub async fn reload(&self) -> Result<(), String> {
        info!("Sending reload signal to NGINX (-s reload)");
        let output = Command::new(&self.nginx_bin)
            .arg("-c")
            .arg(&self.nginx_conf)
            .arg("-s")
            .arg("reload")
            .output()
            .await
            .map_err(|e| format!("Failed to execute nginx -s reload: {}", e))?;

        if output.status.success() {
            info!("NGINX reload command completed successfully");
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("nginx -s reload failed: {}", stderr))
        }
    }

    /// Supervise NGINX child process and return exit status if terminated
    pub async fn wait_or_check(&self) -> Option<ExitStatus> {
        let mut guard = self.child.lock().await;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    Some(status)
                }
                Ok(None) => None,
                Err(e) => {
                    error!("Error polling NGINX child process: {}", e);
                    None
                }
            }
        } else {
            None
        }
    }

    /// Gracefully terminate NGINX process (SIGQUIT)
    pub async fn stop(&self) {
        let mut guard = self.child.lock().await;
        if let Some(mut child) = guard.take() {
            info!("Stopping NGINX process gracefully...");
            let _ = Command::new(&self.nginx_bin)
                .arg("-c")
                .arg(&self.nginx_conf)
                .arg("-s")
                .arg("quit")
                .output()
                .await;

            let timeout = tokio::time::sleep(tokio::time::Duration::from_secs(3));
            tokio::pin!(timeout);

            tokio::select! {
                _ = child.wait() => {
                    info!("NGINX exited cleanly");
                }
                _ = &mut timeout => {
                    warn!("NGINX did not exit in time, terminating process forcefully");
                    let _ = child.kill().await;
                }
            }
        }
    }
}
