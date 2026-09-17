pub mod extensions;
pub mod l4;
pub mod route;
pub mod tls;
pub mod upstream;

#[cfg(test)]
mod tests;

pub use extensions::render_extensions;
pub use l4::generate_l4_streams_conf;
pub use route::generate_domain_routing_conf;
pub use route as routing;
pub use tls::materialize_tls;
pub use upstream::generate_upstreams_conf;

use super::schema::Spec;
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

/// Materialize an extension policy snapshot JSON. The NGINX module owns request-time
/// evaluation through FFI; the agent only materializes its desired state.
async fn materialize_policy_snapshot(
    policy_dir: &Path,
    filename: &str,
    release_id: u64,
    config: Option<&serde_json::Value>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let path = policy_dir.join(filename);
    if let Some(config) = config {
        let mut obj = config
            .as_object()
            .ok_or_else(|| format!("{filename} config must be a JSON object"))?
            .clone();
        obj.insert("schema_version".to_string(), serde_json::json!(1));
        obj.insert("generation".to_string(), serde_json::json!(release_id));
        let json = serde_json::to_string_pretty(&serde_json::Value::Object(obj))?;
        if atomic_write_if_changed(&path, json.as_bytes()).await? {
            info!("Updated {filename} (release_id: {release_id})");
            return Ok(true);
        }
    } else {
        match tokio::fs::remove_file(&path).await {
            Ok(()) => return Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(Box::new(error)),
        }
    }
    Ok(false)
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

    // 1. Extension policy snapshots (evaluated by Rust Engine FFI)
    if materialize_policy_snapshot(
        policy_dir,
        "active-ip-restriction.json",
        spec.release_id,
        rendered_extensions.ip_restriction_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-jwt.json",
        spec.release_id,
        rendered_extensions.jwt_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-rate-limit.json",
        spec.release_id,
        rendered_extensions.rate_limit_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-connection-limit.json",
        spec.release_id,
        rendered_extensions.conn_limit_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-traffic-shaper.json",
        spec.release_id,
        rendered_extensions.traffic_shaper_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-request-size-limit.json",
        spec.release_id,
        rendered_extensions.request_size_limit_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-traffic-split.json",
        spec.release_id,
        rendered_extensions.traffic_split_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-canary-release.json",
        spec.release_id,
        rendered_extensions.canary_release_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-blue-green.json",
        spec.release_id,
        rendered_extensions.blue_green_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-request-mirror.json",
        spec.release_id,
        rendered_extensions.request_mirror_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }
    if materialize_policy_snapshot(
        policy_dir,
        "active-request-termination.json",
        spec.release_id,
        rendered_extensions.request_termination_policy.as_ref(),
    )
    .await?
    {
        changed = true;
    }

    // 2. Upstream Configuration (Object: Upstream)
    if upstream::materialize_upstreams(spec, policy_dir).await? {
        changed = true;
    }

    // 3. TLS Certificates & Origin Credentials (Object: Certificate / TLS)
    if tls::materialize_tls(spec, routing_dir).await? {
        changed = true;
    }

    // 4. L7 Domain & Route Configuration (Object: Route)
    if route::materialize_routes(spec, routing_dir).await? {
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

    // 8. L4 Stream Configuration (Object: L4)
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
