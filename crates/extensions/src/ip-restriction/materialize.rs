//! IP Restriction Materialization (Slot 0).
//!
//! Emits 0 NGINX directives (NGINX remains pure listener/proxy)
//! and compiles the configuration to the Dataplane SHM slot `AURORA_EXT_IP_RESTRICTION`.

use aurora_engine::shm::AURORA_EXT_IP_RESTRICTION;
use serde_json::Value;

use super::policy::IpRestrictionPolicy;

/// Materializes IP restriction configuration into Dataplane SHM slot 0.
pub fn materialize(config_val: &Value, shm_slots: &mut Vec<(u32, Vec<u8>)>) -> Result<(), String> {
    let policy: IpRestrictionPolicy = serde_json::from_value(config_val.clone())
        .map_err(|e| format!("invalid ip-restriction config: {e}"))?;

    policy.validate()?;

    let json_bytes =
        serde_json::to_vec(&policy).map_err(|e| format!("serialize ip-restriction policy: {e}"))?;

    shm_slots.retain(|(slot, _)| *slot != AURORA_EXT_IP_RESTRICTION);
    shm_slots.push((AURORA_EXT_IP_RESTRICTION, json_bytes));

    Ok(())
}
