pub mod extensions;
pub mod l4;
pub mod route;
pub mod tls;
pub mod upstream;

#[cfg(test)]
mod tests;

pub use extensions::render_extensions;
pub use l4::generate_l4_streams_conf;
pub use route as routing;
pub use route::generate_domain_routing_conf;
pub use tls::materialize_tls;
pub use upstream::generate_upstreams_conf;

use super::schema::Spec;
use std::path::Path;
use tracing::info;

pub struct MaterializeResult {
    pub nginx_changed: bool,
    pub policy_changed: bool,
}

use aurora_engine::shm::{
    AURORA_EXT_BLUE_GREEN, AURORA_EXT_CANARY_RELEASE, AURORA_EXT_CONN_LIMIT,
    AURORA_EXT_IP_RESTRICTION, AURORA_EXT_JWT, AURORA_EXT_RATE_LIMIT, AURORA_EXT_REQUEST_MIRROR,
    AURORA_EXT_REQUEST_SIZE_LIMIT, AURORA_EXT_REQUEST_TERMINATION, AURORA_EXT_TRAFFIC_SHAPER,
    AURORA_EXT_TRAFFIC_SPLIT, POLICY_SHM_DEFAULT_PATH, POLICY_SHM_TOTAL_BYTES, PolicyShmHeader,
};
use std::os::unix::fs::OpenOptionsExt;

/// Synchronizes dynamic policy snapshots directly to Shared Memory (SHM).
/// Guarantees zero disk writes and zero reload for dynamic policy hot-swap.
pub fn sync_policy_to_shm(
    release_id: u64,
    rendered: &extensions::RenderedExtensions,
    shm_path: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let target = shm_path.unwrap_or(POLICY_SHM_DEFAULT_PATH);
    if let Some(parent) = std::path::Path::new(target).parent()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }

    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(target)
        .or_else(|_| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o666)
                .open(target)
        })?;

    file.set_len(POLICY_SHM_TOTAL_BYTES as u64)?;
    let fd = std::os::unix::io::AsRawFd::as_raw_fd(&file);

    // SAFETY: We mmap exactly POLICY_SHM_TOTAL_BYTES with MAP_SHARED for cross-process
    // lockless synchronization between Agent and NGINX worker processes.
    let ptr = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            POLICY_SHM_TOTAL_BYTES,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            fd,
            0,
        )
    };

    if ptr == libc::MAP_FAILED || ptr.is_null() {
        return Err(format!("failed to mmap policy shm at {target}").into());
    }

    // SAFETY: The mmap region is backed by a file truncated to POLICY_SHM_TOTAL_BYTES,
    // which matches the exact size and alignment of PolicyShmHeader.
    let header = unsafe { &mut *(ptr as *mut PolicyShmHeader) };
    header.ensure_header();

    let slots: [(u32, Option<&serde_json::Value>); 11] = [
        (
            AURORA_EXT_IP_RESTRICTION,
            rendered.ip_restriction_policy.as_ref(),
        ),
        (AURORA_EXT_JWT, rendered.jwt_policy.as_ref()),
        (AURORA_EXT_RATE_LIMIT, rendered.rate_limit_policy.as_ref()),
        (AURORA_EXT_CONN_LIMIT, rendered.conn_limit_policy.as_ref()),
        (
            AURORA_EXT_TRAFFIC_SHAPER,
            rendered.traffic_shaper_policy.as_ref(),
        ),
        (
            AURORA_EXT_REQUEST_SIZE_LIMIT,
            rendered.request_size_limit_policy.as_ref(),
        ),
        (
            AURORA_EXT_TRAFFIC_SPLIT,
            rendered.traffic_split_policy.as_ref(),
        ),
        (
            AURORA_EXT_CANARY_RELEASE,
            rendered.canary_release_policy.as_ref(),
        ),
        (AURORA_EXT_BLUE_GREEN, rendered.blue_green_policy.as_ref()),
        (
            AURORA_EXT_REQUEST_MIRROR,
            rendered.request_mirror_policy.as_ref(),
        ),
        (
            AURORA_EXT_REQUEST_TERMINATION,
            rendered.request_termination_policy.as_ref(),
        ),
    ];

    let mut any_changed = false;

    for (slot_id, config) in slots {
        if let Some(config) = config {
            let mut obj = config
                .as_object()
                .ok_or_else(|| format!("slot {slot_id} config must be a JSON object"))?
                .clone();
            obj.insert("schema_version".to_string(), serde_json::json!(1));
            obj.insert("generation".to_string(), serde_json::json!(release_id));
            let json_bytes = serde_json::to_vec(&serde_json::Value::Object(obj))?;

            // Avoid rewriting identical payload to save memory bus bandwidth
            if let Some((slot_gen, data)) = header.read_slot(slot_id)
                && slot_gen == release_id
                && data == json_bytes.as_slice()
            {
                continue;
            }

            header.update_slot(slot_id, release_id, Some(&json_bytes));
            any_changed = true;
        } else {
            // Extension is disabled or unconfigured in this release
            if let Some((_, data)) = header.read_slot(slot_id)
                && data.is_empty()
            {
                continue;
            }
            header.update_slot(slot_id, release_id, None);
            any_changed = true;
        }
    }

    // SAFETY: ptr is the valid pointer returned by mmap above, unmapping exact length.
    unsafe {
        libc::munmap(ptr, POLICY_SHM_TOTAL_BYTES);
    }

    Ok(any_changed)
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

    // 1. Dynamic extension policies (synchronized directly to Shared Memory for zero-reload hot-swap)
    let shm_target = if let Ok(path) = std::env::var("AURORA_POLICY_SHM_PATH") {
        Some(path)
    } else if policy_dir.starts_with(std::env::temp_dir())
        || policy_dir.to_string_lossy().contains("materialize-")
        || policy_dir.to_string_lossy().contains("aurora-agent-test-")
    {
        Some(
            policy_dir
                .join("aurora_gateway_policy.bin")
                .to_string_lossy()
                .to_string(),
        )
    } else {
        None
    };
    let policy_changed =
        sync_policy_to_shm(spec.release_id, &rendered_extensions, shm_target.as_deref())?;
    if policy_changed {
        info!(
            "Updated dynamic policy SHM (release_id: {})",
            spec.release_id
        );
    }

    // Clean up any legacy active-*.json files from policy_dir if present
    for legacy_name in &[
        "active-ip-restriction.json",
        "active-jwt.json",
        "active-rate-limit.json",
        "active-connection-limit.json",
        "active-traffic-shaper.json",
        "active-request-size-limit.json",
        "active-traffic-split.json",
        "active-canary-release.json",
        "active-blue-green.json",
        "active-request-mirror.json",
        "active-request-termination.json",
    ] {
        let legacy_path = policy_dir.join(legacy_name);
        if legacy_path.exists() {
            let _ = tokio::fs::remove_file(legacy_path).await;
        }
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
        policy_changed,
    })
}
