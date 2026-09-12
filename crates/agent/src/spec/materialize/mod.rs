pub mod extensions;
pub mod l4;
pub mod routing;

#[cfg(test)]
mod tests;

pub use extensions::render_extensions;
pub use l4::generate_l4_streams_conf;
pub use routing::generate_domain_routing_conf;

use super::schema::Spec;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tracing::info;

pub struct MaterializeResult {
    pub nginx_changed: bool,
}

/// Atomically write bytes to destination path using a .tmp file.
/// Returns Ok(true) if file content changed, Ok(false) if identical.
pub async fn atomic_write_if_changed(dest: &Path, content: &[u8]) -> std::io::Result<bool> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if dest.exists()
        && let Ok(existing) = tokio::fs::read(dest).await
        && existing == content
    {
        return Ok(false);
    }

    let tmp = dest.with_extension(format!("tmp.{}", std::process::id()));
    tokio::fs::write(&tmp, content).await?;
    tokio::fs::rename(&tmp, dest).await?;
    Ok(true)
}

/// Materialize declarative Spec to concrete NGINX filesystem configuration files.
pub async fn materialize_nginx(
    spec: &Spec,
    policy_dir: &Path,
    routing_dir: &Path,
) -> Result<MaterializeResult, Box<dyn std::error::Error + Send + Sync>> {
    let mut changed = false;
    let rendered_extensions = render_extensions(&spec.extensions)
        .map_err(|error| format!("render extension instances: {error}"))?;

    // 1. WAF Policy
    let policy_path = policy_dir.join("active-policy.json");
    let policy_json = if let Some(ref raw) = spec.waf.raw_json {
        raw.clone()
    } else if !spec.waf.rules.is_empty() {
        serde_json::to_string_pretty(&serde_json::json!({
            "schema_version": 2,
            "generation": spec.release_id,
            "rules": spec.waf.rules,
        }))?
    } else {
        let block_paths = if spec.waf.block_paths.is_empty() {
            vec!["/blocked".to_string(), "/__aurora_blocked".to_string()]
        } else {
            spec.waf.block_paths.clone()
        };
        serde_json::to_string_pretty(&serde_json::json!({
            "schema_version": 1,
            "block_paths": block_paths,
        }))?
    };
    if atomic_write_if_changed(&policy_path, policy_json.as_bytes()).await? {
        info!(
            "Updated active-policy.json (release_id: {})",
            spec.release_id
        );
        changed = true;
    }

    // 2. Access Policy (NGINX C engine requires active-access.json)
    let access_path = policy_dir.join("active-access.json");
    let access_json = serde_json::to_string_pretty(&serde_json::json!({
        "schema_version": 1,
        "generation": spec.release_id,
        "rules": rendered_extensions.access_rules,
    }))?;
    if atomic_write_if_changed(&access_path, access_json.as_bytes()).await? {
        info!("Updated active-access.json");
        changed = true;
    }

    // 3. JWT authorization snapshot. The NGINX module owns request-time
    // verification through FFI; the agent only materializes its desired state.
    let jwt_path = policy_dir.join("active-jwt.json");
    if let Some(jwt_config) = rendered_extensions.jwt_policy.as_ref() {
        let mut jwt_obj = jwt_config
            .as_object()
            .ok_or_else(|| "jwt config must be a JSON object".to_string())?
            .clone();
        jwt_obj.insert("schema_version".to_string(), serde_json::json!(1));
        jwt_obj.insert("generation".to_string(), serde_json::json!(spec.release_id));
        let jwt_json = serde_json::to_string_pretty(&serde_json::Value::Object(jwt_obj))?;
        if atomic_write_if_changed(&jwt_path, jwt_json.as_bytes()).await? {
            info!("Updated active-jwt.json");
            changed = true;
        }
    } else {
        match tokio::fs::remove_file(&jwt_path).await {
            Ok(()) => changed = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Box::new(error)),
        }
    }

    // 4. Rate Limiting snapshot. The NGINX module owns request-time
    // evaluation through FFI; the agent only materializes its desired state.
    let rate_limit_path = policy_dir.join("active-rate-limit.json");
    if let Some(rl_config) = rendered_extensions.rate_limit_policy.as_ref() {
        let mut rl_obj = rl_config
            .as_object()
            .ok_or_else(|| "rate-limit config must be a JSON object".to_string())?
            .clone();
        rl_obj.insert("schema_version".to_string(), serde_json::json!(1));
        rl_obj.insert("generation".to_string(), serde_json::json!(spec.release_id));
        let rl_json = serde_json::to_string_pretty(&serde_json::Value::Object(rl_obj))?;
        if atomic_write_if_changed(&rate_limit_path, rl_json.as_bytes()).await? {
            info!("Updated active-rate-limit.json");
            changed = true;
        }
    } else {
        match tokio::fs::remove_file(&rate_limit_path).await {
            Ok(()) => changed = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Box::new(error)),
        }
    }

    // 5. Connection Limiting snapshot.
    let conn_limit_path = policy_dir.join("active-connection-limit.json");
    if let Some(cl_config) = rendered_extensions.conn_limit_policy.as_ref() {
        let mut cl_obj = cl_config
            .as_object()
            .ok_or_else(|| "connection-limit config must be a JSON object".to_string())?
            .clone();
        cl_obj.insert("schema_version".to_string(), serde_json::json!(1));
        cl_obj.insert("generation".to_string(), serde_json::json!(spec.release_id));
        let cl_json = serde_json::to_string_pretty(&serde_json::Value::Object(cl_obj))?;
        if atomic_write_if_changed(&conn_limit_path, cl_json.as_bytes()).await? {
            info!("Updated active-connection-limit.json");
            changed = true;
        }
    } else {
        match tokio::fs::remove_file(&conn_limit_path).await {
            Ok(()) => changed = true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Box::new(error)),
        }
    }

    // 6. Upstreams Config
    let upstreams_path = policy_dir.join("active-upstreams.conf");
    let upstreams_content = if let Some(ref raw) = spec.upstreams_conf {
        raw.clone()
    } else if !spec.upstreams.is_empty() {
        let mut buf = String::from("# Generated by Aurora Dataplane Agent\n");
        for up in &spec.upstreams {
            buf.push_str(&format!("upstream {} {{\n", up.name));
            buf.push_str(&format!("    zone aurora_http_{} 64k;\n", up.name));
            for s in &up.servers {
                buf.push_str(&format!(
                    "    server {} weight={} resolve;\n",
                    s.addr, s.weight
                ));
            }
            buf.push_str("}\n");
        }
        buf
    } else {
        "# No active upstreams configured\n".to_string()
    };
    if atomic_write_if_changed(&upstreams_path, upstreams_content.as_bytes()).await? {
        info!("Updated active-upstreams.conf");
        changed = true;
    }

    // 3.5 Materialize SSL Certificates
    let certs_dir = routing_dir.join("certs");
    for cert in &spec.certificates {
        if !cert.cert_pem.trim().is_empty() {
            let cert_file = certs_dir.join(format!("{}.crt", cert.id));
            if atomic_write_if_changed(&cert_file, cert.cert_pem.as_bytes()).await? {
                info!("Updated SSL certificate file {}", cert_file.display());
                changed = true;
            }
        }
        if !cert.key_pem.trim().is_empty() {
            let key_file = certs_dir.join(format!("{}.key", cert.id));
            if atomic_write_if_changed(&key_file, cert.key_pem.as_bytes()).await? {
                info!("Updated SSL private key file {}", key_file.display());
                changed = true;
            }
            tokio::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600)).await?;
        }
        if cert.mtls_enabled && !cert.client_ca_pem.trim().is_empty() {
            let ca_file = certs_dir.join(format!("{}_ca.crt", cert.id));
            if atomic_write_if_changed(&ca_file, cert.client_ca_pem.as_bytes()).await? {
                info!("Updated SSL client CA file {}", ca_file.display());
                changed = true;
            }
        }
    }

    // 3.6 Materialize origin TLS trust and client credentials. These files are
    // referenced only from the route that owns the selected upstream.
    let origin_tls_dir = routing_dir.join("origin-tls");
    for domain in &spec.routing.domains {
        for location in &domain.locations {
            let Some(tls) = location.origin_tls.as_ref().filter(|tls| tls.enabled) else {
                continue;
            };

            if tls.verify_cert && !tls.ca_cert.trim().is_empty() {
                let ca_file = origin_tls_dir.join(format!("{}_ca.crt", location.upstream));
                if atomic_write_if_changed(&ca_file, tls.ca_cert.as_bytes()).await? {
                    info!("Updated origin TLS CA file {}", ca_file.display());
                    changed = true;
                }
            }
            if tls.mtls {
                let cert_file = origin_tls_dir.join(format!("{}_client.crt", location.upstream));
                if atomic_write_if_changed(&cert_file, tls.client_cert.as_bytes()).await? {
                    info!(
                        "Updated origin TLS client certificate {}",
                        cert_file.display()
                    );
                    changed = true;
                }

                let key_file = origin_tls_dir.join(format!("{}_client.key", location.upstream));
                if atomic_write_if_changed(&key_file, tls.client_key.as_bytes()).await? {
                    info!(
                        "Updated origin TLS client private key {}",
                        key_file.display()
                    );
                    changed = true;
                }
                tokio::fs::set_permissions(&key_file, std::fs::Permissions::from_mode(0o600))
                    .await?;
            }
        }
    }

    // 4. Domain Routing Config
    let routing_path = routing_dir.join("active-domain-routing.conf");
    let routing_content = generate_domain_routing_conf(spec, routing_dir);
    if atomic_write_if_changed(&routing_path, routing_content.as_bytes()).await? {
        info!("Updated active-domain-routing.conf");
        changed = true;
    }

    // 5. Extensions NGINX Directives (HTTP block)
    let extensions_http_path = policy_dir.join("active-extensions-http.conf");
    let extensions_http_content = rendered_extensions.http_conf;
    if atomic_write_if_changed(&extensions_http_path, extensions_http_content.as_bytes()).await? {
        info!("Updated active-extensions-http.conf");
        changed = true;
    }

    // 6. Extensions NGINX Directives (Server block)
    let extensions_path = policy_dir.join("active-extensions.conf");
    let extensions_content = rendered_extensions.server_conf;
    if atomic_write_if_changed(&extensions_path, extensions_content.as_bytes()).await? {
        info!("Updated active-extensions.conf");
        changed = true;
    }

    // 7. Dynamic Extension Modules (load_module directives)
    let modules_dir = routing_dir.join("dependencies/current");
    if !modules_dir.exists() {
        let _ = tokio::fs::create_dir_all(&modules_dir).await;
    }
    let modules_path = modules_dir.join("modules.conf");
    let modules_content = rendered_extensions.modules_conf;
    if atomic_write_if_changed(&modules_path, modules_content.as_bytes()).await? {
        info!("Updated modules.conf for dynamic extension modules");
        changed = true;
    }

    // 8. L4 Stream Configuration (active-l4-streams.conf)
    let l4_path = routing_dir.join("active-l4-streams.conf");
    let l4_content = generate_l4_streams_conf(&spec.l4)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    if atomic_write_if_changed(&l4_path, l4_content.as_bytes()).await? {
        info!("Updated active-l4-streams.conf");
        changed = true;
    }

    Ok(MaterializeResult {
        nginx_changed: changed,
    })
}
