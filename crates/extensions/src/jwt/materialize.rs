//! JWT Extension Materialization (Slot 1).
//!
//! Emits 0 NGINX directives (NGINX remains pure listener/proxy)
//! and compiles the configuration to the Dataplane SHM slot `AURORA_EXT_JWT`.

use aurora_engine::shm::AURORA_EXT_JWT;
use serde_json::Value;

use super::policy::JwtPolicy;

/// Materializes JWT configuration into Dataplane SHM slot 1.
pub fn materialize(config_val: &Value, shm_slots: &mut Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    let policy: JwtPolicy = serde_json::from_value(config_val.clone())
        .map_err(|e| format!("invalid jwt config: {e}"))?;

    policy.validate()?;

    let json_bytes =
        serde_json::to_vec(&policy).map_err(|e| format!("serialize jwt policy: {e}"))?;

    shm_slots.retain(|(slot, _)| *slot != AURORA_EXT_JWT);
    shm_slots.push((AURORA_EXT_JWT, json_bytes));

    Ok(())
}
