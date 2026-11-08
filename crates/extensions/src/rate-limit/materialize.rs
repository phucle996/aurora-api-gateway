//! Rate Limit Materialization (Slot 2).
//!
//! Emits 0 NGINX directives (NGINX remains pure listener/proxy)
//! and compiles the configuration to the Dataplane SHM slot `AURORA_EXT_RATE_LIMIT`.

use aurora_engine::shm::AURORA_EXT_RATE_LIMIT;
use serde_json::Value;

use super::policy::RateLimitPolicy;

/// Materializes rate-limit configuration into Dataplane SHM slot 2.
pub fn materialize(config_val: &Value, shm_slots: &mut Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    let policy: RateLimitPolicy = serde_json::from_value(config_val.clone())
        .map_err(|e| format!("invalid rate-limit config: {e}"))?;

    policy.validate()?;

    let json_bytes =
        serde_json::to_vec(&policy).map_err(|e| format!("serialize rate-limit policy: {e}"))?;

    shm_slots.retain(|(slot, _)| *slot != AURORA_EXT_RATE_LIMIT);
    shm_slots.push((AURORA_EXT_RATE_LIMIT, json_bytes));

    Ok(())
}
