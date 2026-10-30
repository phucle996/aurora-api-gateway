//! Response Cache Materialization.
//!
//! Emits 0 NGINX directives (NGINX remains pure listener/proxy)
//! and compiles the configuration to the Dataplane SHM slot `AURORA_EXT_RESPONSE_CACHE`.

use aurora_engine::shm::AURORA_EXT_RESPONSE_CACHE;
use serde_json::Value;

use super::policy::ResponseCacheConfig;

/// Materializes response-cache configuration into Dataplane SHM slot 12.
pub fn materialize(
    config_val: &Value,
    shm_slots: &mut Vec<(u32, Vec<u8>)>,
) -> Result<(), String> {
    let cfg: ResponseCacheConfig = serde_json::from_value(config_val.clone())
        .map_err(|e| format!("invalid response-cache config: {e}"))?;

    let json_bytes = serde_json::to_vec(&cfg)
        .map_err(|e| format!("serialize response-cache policy: {e}"))?;

    shm_slots.retain(|(slot, _)| *slot != AURORA_EXT_RESPONSE_CACHE);
    shm_slots.push((AURORA_EXT_RESPONSE_CACHE, json_bytes));

    Ok(())
}
