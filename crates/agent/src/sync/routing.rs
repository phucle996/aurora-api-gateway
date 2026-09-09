use crate::config::Config;
use crate::nginx::NginxManager;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::fs;
use tracing::{error, info, warn};

#[derive(Deserialize, Debug)]
struct CertificateAsset {
    name: String,
    content: String,
}

#[derive(Deserialize, Debug)]
struct DomainRoutingBundle {
    config: String,
    files: Vec<CertificateAsset>,
}

pub async fn run_routing_sync_loop(
    cfg: Arc<Config>,
    client: Client,
    nginx: Arc<NginxManager>,
) {
    let interval = tokio::time::Duration::from_secs(cfg.sync_interval_secs);
    let mut ticker = tokio::time::interval(interval);

    let certs_dir = cfg.routing_dir.join("certificates");
    let active_conf = cfg.routing_dir.join("active-domain-routing.conf");
    let candidate_conf = cfg.routing_dir.join("candidate-domain-routing.conf");
    let previous_conf = cfg.routing_dir.join("previous-domain-routing.conf");

    let _ = fs::create_dir_all(&certs_dir).await;
    if !active_conf.exists() {
        let _ = fs::write(&active_conf, "# Initial domain routing\n").await;
    }

    loop {
        ticker.tick().await;

        let url = format!("{}/api/v1/domain-routing/{}/bundle", cfg.controller_url, cfg.node_id);
        let resp = match client
            .get(&url)
            .header("Authorization", format!("Bearer {}", cfg.auth_token))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                warn!(status = %r.status(), "Domain routing bundle fetch returned non-success");
                continue;
            }
            Err(e) => {
                error!("Failed to fetch domain routing bundle: {}", e);
                continue;
            }
        };

        let bundle: DomainRoutingBundle = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                error!("Failed to parse domain routing bundle JSON: {}", e);
                continue;
            }
        };

        // 1. Process & Validate Certificates
        let mut certs_ok = true;
        for asset in &bundle.files {
            if !asset.name.ends_with(".pem") {
                certs_ok = false;
                break;
            }
            let cert_path = certs_dir.join(&asset.name);

            let decoded_bytes = match asset.content.as_bytes() {
                b if b.starts_with(b"-----BEGIN") => b.to_vec(),
                _ => {
                    // Try decoding base64 if not plain PEM text
                    match simple_base64_decode(&asset.content) {
                        Some(b) => b,
                        None => {
                            error!("Failed to decode certificate base64 for {}", asset.name);
                            certs_ok = false;
                            break;
                        }
                    }
                }
            };

            // Verify sha256 checksum
            let mut hasher = Sha256::new();
            hasher.update(&decoded_bytes);
            let hash_hex = hex::encode(hasher.finalize());
            if format!("{}.pem", hash_hex) != asset.name {
                error!(
                    expected = %asset.name,
                    actual = %hash_hex,
                    "Certificate checksum mismatch"
                );
                certs_ok = false;
                break;
            }

            if let Err(e) = fs::write(&cert_path, &decoded_bytes).await {
                error!("Failed to write certificate {}: {}", asset.name, e);
                certs_ok = false;
                break;
            }
        }

        if !certs_ok {
            error!("Certificate verification failed; aborting routing update");
            continue;
        }

        // 2. Stage Candidate Configuration
        if let Err(e) = fs::write(&candidate_conf, &bundle.config).await {
            error!("Failed to write candidate routing config: {}", e);
            continue;
        }

        let active_content = fs::read_to_string(&active_conf).await.unwrap_or_default();
        if active_content == bundle.config {
            // No changes
            continue;
        }

        info!("Observed domain routing change; testing candidate configuration");

        // 3. Canary Test Configuration
        if !cfg.no_nginx {
            // Swap candidate temporarily to test
            let _ = fs::copy(&active_conf, &previous_conf).await;
            let _ = fs::copy(&candidate_conf, &active_conf).await;

            match nginx.test_config(&cfg.nginx_conf).await {
                Ok(_) => {
                    info!("NGINX syntax validation passed; reloading");
                    if let Err(e) = nginx.reload().await {
                        error!("NGINX reload failed: {}; rolling back configuration", e);
                        let _ = fs::copy(&previous_conf, &active_conf).await;
                        let _ = nginx.reload().await;
                    } else {
                        info!("Domain routing successfully updated and applied");
                    }
                }
                Err(e) => {
                    error!("NGINX candidate validation failed: {}; rolling back", e);
                    let _ = fs::copy(&previous_conf, &active_conf).await;
                }
            }
        } else {
            let _ = fs::copy(&candidate_conf, &active_conf).await;
        }
    }
}

fn simple_base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);

    let mut buf = 0u32;
    let mut bits = 0;

    for &b in &clean {
        if b == b'=' {
            break;
        }
        let val = TABLE.iter().position(|&c| c == b)? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}
