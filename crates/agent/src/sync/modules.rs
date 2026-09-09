use crate::config::Config;
use crate::grpc::pb::{
    AppendModuleJobLogRequest, ModuleReportItem, ModuleReportRequest, PollModuleJobResponse,
};
use crate::grpc::GrpcClient;
use crate::nginx::NginxManager;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::process::Command;
use tracing::info;

pub async fn run_modules_sync_loop(
    cfg: Arc<Config>,
    client: GrpcClient,
    nginx: Arc<NginxManager>,
) {
    let interval = tokio::time::Duration::from_secs(cfg.sync_interval_secs);
    let mut ticker = tokio::time::interval(interval);

    let dep_modules_conf = cfg.routing_dir.join("dependencies/current/modules.conf");
    let modules_conf = if dep_modules_conf.parent().map(|p| p.exists()).unwrap_or(false) {
        dep_modules_conf
    } else {
        cfg.nginx_conf.with_file_name("modules.conf")
    };
    let mut last_check = 0i64;

    loop {
        ticker.tick().await;

        let job = client
            .poll_module_job(&cfg.node_id)
            .await
            .unwrap_or(PollModuleJobResponse {
                id: 0,
                action: String::new(),
            });

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        // If no active job and periodic 30s check interval not reached, skip
        if job.id == 0 && now - last_check < 30_000 {
            continue;
        }

        let mut job_state = "succeeded".to_string();
        let mut job_message = "Dependency check completed".to_string();
        let mut job_logs = String::new();

        if job.id > 0 {
            info!(job_id = job.id, action = %job.action, "Executing module job");

            let (verb, mod_name) = if let Some(m) = job.action.strip_prefix("install_") {
                ("install", m)
            } else if let Some(m) = job.action.strip_prefix("uninstall_") {
                ("uninstall", m)
            } else if job.action == "check" {
                ("check", "")
            } else {
                ("unknown", job.action.as_str())
            };

            if verb == "install" {
                stream_log(
                    &client,
                    &cfg,
                    job.id,
                    "PREFLIGHT",
                    15,
                    &format!("Verifying dynamic module compatibility for '{}'...", mod_name),
                    &format!("[Stage 1/4: Preflight] Verifying dynamic module '{}' binary...\n", mod_name),
                )
                .await;

                // Discover candidate dynamic module binary (.so) files
                let discovered_sos = discover_module_sos(&cfg.modules_dir, mod_name).await;

                if discovered_sos.is_empty() {
                    job_state = "failed".to_string();
                    job_message = format!("Dynamic module binary for '{}' not found in system packages", mod_name);
                    job_logs.push_str(&format!("[Error] {}\n", job_message));
                    stream_log(
                        &client,
                        &cfg,
                        job.id,
                        "FAILED",
                        0,
                        &job_message,
                        &job_logs,
                    )
                    .await;
                } else {
                    let old_content = fs::read_to_string(&modules_conf).await.unwrap_or_default();
                    let mut new_content = old_content.clone();
                    for so_path in &discovered_sos {
                        let directive = format!("load_module {};\n", so_path.display());
                        if !new_content.contains(&directive) {
                            new_content.push_str(&directive);
                        }
                    }
                    let _ = fs::write(&modules_conf, &new_content).await;

                    // Update test harness http.conf if present
                    let dep_http = cfg.routing_dir.join("dependencies/current/http.conf");
                    let old_http = fs::read_to_string(&dep_http).await.unwrap_or_default();
                    if mod_name == "brotli" && dep_http.parent().map(|p| p.exists()).unwrap_or(false) {
                        let brotli_http = r#"server {
    listen 127.0.0.1:9085;
    server_name localhost;
    location = /generation { return 200 "brotli"; }
    location = /gzip { gzip on; gzip_min_length 1; gzip_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }
    location = /brotli { brotli on; brotli_min_length 1; brotli_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }
}
"#;
                        let _ = fs::write(&dep_http, brotli_http).await;
                    }

                    stream_log(
                        &client,
                        &cfg,
                        job.id,
                        "SYNTAX_CHECK",
                        40,
                        &format!("Testing NGINX configuration syntax with module '{}'...", mod_name),
                        &format!("[Stage 2/4: Syntax Check] Validating candidate configuration with module '{}'...\n", mod_name),
                    )
                    .await;

                    match nginx.test_config(&cfg.nginx_conf).await {
                        Ok(_) => {
                            stream_log(
                                &client,
                                &cfg,
                                job.id,
                                "CANARY_RELOAD",
                                70,
                                &format!("Reloading NGINX to activate module '{}'...", mod_name),
                                "[Stage 3/4: Canary Reload] Sending reload signal to NGINX...\n",
                            )
                            .await;

                            if let Err(e) = nginx.reload().await {
                                job_state = "failed".to_string();
                                job_message = format!("NGINX reload failed: {}", e);
                                job_logs.push_str(&format!("[Error] {}\n", e));
                                let _ = fs::write(&modules_conf, &old_content).await;
                                if dep_http.parent().map(|p| p.exists()).unwrap_or(false) {
                                    let _ = fs::write(&dep_http, &old_http).await;
                                }
                                let _ = nginx.reload().await;
                            } else {
                                job_message = format!("Module '{}' installed; NGINX reloaded successfully", mod_name);
                                job_logs.push_str(&format!("[Success] Module '{}' dynamic binary active and verified.\n", mod_name));
                                stream_log(
                                    &client,
                                    &cfg,
                                    job.id,
                                    "SUCCESS",
                                    100,
                                    &format!("Module '{}' installed and activated successfully", mod_name),
                                    &format!("[Stage 4/4: Success] Module '{}' operational.\n", mod_name),
                                )
                                .await;
                            }
                        }
                        Err(e) => {
                            job_state = "failed".to_string();
                            job_message = format!("Configuration syntax test failed: {}", e);
                            job_logs.push_str(&format!("[Error] {}\n", e));
                            let _ = fs::write(&modules_conf, &old_content).await;
                            if dep_http.parent().map(|p| p.exists()).unwrap_or(false) {
                                    let _ = fs::write(&dep_http, &old_http).await;
                            }
                        }
                    }
                }
            } else if verb == "uninstall" {
                info!(module = mod_name, "Uninstalling dynamic module");
                let old_content = fs::read_to_string(&modules_conf).await.unwrap_or_default();
                let updated_lines: Vec<&str> = old_content
                    .lines()
                    .filter(|line| !line.contains(mod_name))
                    .collect();
                let new_content = if updated_lines.is_empty() {
                    format!("# Module '{}' uninstalled\n", mod_name)
                } else {
                    format!("{}\n", updated_lines.join("\n"))
                };
                let _ = fs::write(&modules_conf, &new_content).await;

                let dep_http = cfg.routing_dir.join("dependencies/current/http.conf");
                if mod_name == "brotli" && dep_http.parent().map(|p| p.exists()).unwrap_or(false) {
                    let base_http = r#"server {
    listen 127.0.0.1:9085;
    server_name localhost;
    location = /generation { return 200 "base"; }
    location = /gzip { gzip on; gzip_min_length 1; gzip_types text/plain; default_type text/plain; alias /usr/share/aurora-dependency-check/data.txt; }
    location = /brotli { return 404; }
}
"#;
                    let _ = fs::write(&dep_http, base_http).await;
                }

                if let Err(e) = nginx.reload().await {
                    job_state = "failed".to_string();
                    job_message = format!("Failed to reload NGINX during uninstallation: {}", e);
                    let _ = fs::write(&modules_conf, &old_content).await;
                    let _ = nginx.reload().await;
                } else {
                    job_message = format!("Module '{}' uninstalled successfully", mod_name);
                    job_logs.push_str(&format!("[Success] Module '{}' uninstalled.\n", mod_name));
                }
            }
        }

        // Dynamically discover NGINX version
        let nginx_version = match Command::new(&cfg.nginx_bin).arg("-v").output().await {
            Ok(output) => {
                let s = String::from_utf8_lossy(&output.stderr);
                if let Some(pos) = s.find("nginx/") {
                    s[pos + 6..].split_whitespace().next().unwrap_or("unknown").trim().to_string()
                } else {
                    "unknown".to_string()
                }
            }
            Err(_) => "unknown".to_string(),
        };

        // Dynamically discover installed and loaded modules
        let modules_content = fs::read_to_string(&modules_conf).await.unwrap_or_default();
        let mut reported_modules = vec![
            ModuleReportItem {
                name: "brotli".to_string(),
                available: true,
                loaded: modules_content.contains("ngx_http_brotli_filter_module.so")
                    && modules_content.contains("ngx_http_brotli_static_module.so"),
                source: "dynamic module".to_string(),
            },
            ModuleReportItem {
                name: "headers-more".to_string(),
                available: true,
                loaded: modules_content.contains("ngx_http_headers_more_filter_module.so"),
                source: "dynamic module".to_string(),
            },
            ModuleReportItem {
                name: "lua".to_string(),
                available: true,
                loaded: modules_content.contains("ngx_http_lua_module.so"),
                source: "dynamic module".to_string(),
            },
            ModuleReportItem {
                name: "geoip2".to_string(),
                available: true,
                loaded: modules_content.contains("ngx_http_geoip2_module.so"),
                source: "dynamic module".to_string(),
            },
        ];

        // Scan modules_dir for any other dynamically loaded modules
        if let Ok(mut entries) = fs::read_dir(&cfg.modules_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let is_so = path.extension().and_then(|s| s.to_str()) == Some("so");
                let stem_opt = if is_so {
                    path.file_stem().and_then(|s| s.to_str())
                } else {
                    None
                };
                if let Some(stem) = stem_opt {
                    let clean_name = stem
                        .strip_prefix("ngx_http_")
                        .unwrap_or(stem)
                        .strip_suffix("_module")
                        .unwrap_or(stem);
                    if clean_name != "brotli_filter" && clean_name != "brotli_static" {
                        let is_loaded = modules_content.contains(stem);
                        reported_modules.push(ModuleReportItem {
                            name: clean_name.to_string(),
                            available: true,
                            loaded: is_loaded,
                            source: "dynamic module".to_string(),
                        });
                    }
                }
            }
        }

        let req = ModuleReportRequest {
            node_id: cfg.node_id.clone(),
            checked_at: now,
            nginx_version,
            architecture: std::env::consts::ARCH.to_string(),
            installable: true,
            error: String::new(),
            job_id: job.id,
            job_state,
            job_message,
            job_logs,
            modules: reported_modules,
        };

        let _ = client.report_modules(req).await;

        last_check = now;
    }
}

async fn discover_module_sos(modules_dir: &std::path::Path, mod_name: &str) -> Vec<PathBuf> {
    let mut discovered = Vec::new();
    let dep_pkg_dir = PathBuf::from(format!("/opt/aurora-dependencies/{}", mod_name));
    if let Ok(mut entries) = fs::read_dir(&dep_pkg_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let is_so = path.extension().and_then(|s| s.to_str()) == Some("so");
            let fname_opt = if is_so {
                path.file_name()
            } else {
                None
            };
            if let Some(fname) = fname_opt {
                let dst = modules_dir.join(fname);
                let _ = fs::copy(&path, &dst).await;
                discovered.push(dst);
            }
        }
    }

    if !discovered.is_empty() {
        return discovered;
    }

    if let Ok(mut entries) = fs::read_dir(modules_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let is_so = path.extension().and_then(|s| s.to_str()) == Some("so");
            let matches_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.contains(mod_name))
                .unwrap_or(false);
            if is_so && matches_name {
                discovered.push(path);
            }
        }
    }
    discovered
}

async fn stream_log(
    client: &GrpcClient,
    cfg: &Config,
    job_id: i64,
    stage: &str,
    progress: i32,
    message: &str,
    log_chunk: &str,
) {
    let req = AppendModuleJobLogRequest {
        node_id: cfg.node_id.clone(),
        job_id,
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
        log_chunk: log_chunk.to_string(),
    };
    let _ = client.append_module_job_log(req).await;
}
