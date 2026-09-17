//! Shared Memory Log Gating (C ABI Layer)
//!
//! Fast-path check for NGINX worker processes to determine if any log consumers are active.

use super::gateway_metrics;

/// Check if at least one log consumer is registered in Shared Memory.
/// Returns 1 if active, 0 otherwise.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_is_log_active() -> u32 {
    if gateway_metrics().map(|m| m.is_log_active()).unwrap_or(false) {
        1
    } else {
        0
    }
}

#[deprecated(note = "Use aurora_gateway_is_log_active instead")]
#[unsafe(no_mangle)]
pub extern "C" fn aurora_telemetry_is_log_active() -> u32 {
    aurora_gateway_is_log_active()
}

/// Returns the current active log consumers count.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_active_log_consumers() -> u64 {
    gateway_metrics().map(|m| m.active_log_consumers_count()).unwrap_or(0)
}
