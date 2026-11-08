//! Connection Limit Materialization (Slot 3).
//!
//! Emits 0 NGINX directives (NGINX remains pure listener/proxy)
//! and compiles the configuration to the Dataplane SHM slot `AURORA_EXT_CONN_LIMIT`.

use aurora_engine::shm::AURORA_EXT_CONN_LIMIT;
use serde_json::Value;

use super::policy::ConnectionLimitPolicy;

/// Materializes connection-limit configuration into Dataplane SHM slot 3.
pub fn materialize(config_val: &Value, shm_slots: &mut Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    let policy: ConnectionLimitPolicy = serde_json::from_value(config_val.clone())
        .map_err(|e| format!("invalid connection-limit config: {e}"))?;

    policy.validate()?;

    let json_bytes = serde_json::to_vec(&policy)
        .map_err(|e| format!("serialize connection-limit policy: {e}"))?;

    shm_slots.retain(|(slot, _)| *slot != AURORA_EXT_CONN_LIMIT);
    shm_slots.push((AURORA_EXT_CONN_LIMIT, json_bytes));

    Ok(())
}
