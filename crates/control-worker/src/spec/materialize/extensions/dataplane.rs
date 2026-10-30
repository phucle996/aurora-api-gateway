//! Dataplane Shared Memory (SHM) Extension Slot Resolver.
//!
//! Maps dataplane extensions to fixed Shared Memory slot IDs, allowing declarative
//! snapshot payloads to pass directly into worker memory with zero NGINX directives.

use aurora_engine::shm::{
    AURORA_EXT_BLUE_GREEN, AURORA_EXT_CANARY_RELEASE, AURORA_EXT_CONN_LIMIT,
    AURORA_EXT_IP_RESTRICTION, AURORA_EXT_JWT, AURORA_EXT_RATE_LIMIT, AURORA_EXT_REQUEST_MIRROR,
    AURORA_EXT_REQUEST_TERMINATION, AURORA_EXT_RESOURCE_LIMIT, AURORA_EXT_TRAFFIC_SHAPER,
    AURORA_EXT_TRAFFIC_SPLIT,
};

#[inline]
pub fn resolve_dataplane_shm_slot(renderer: &str) -> Option<u32> {
    match renderer {
        "ip-restriction" => Some(AURORA_EXT_IP_RESTRICTION),
        "engine-jwt-rs256" => Some(AURORA_EXT_JWT),
        "rate-limit" => Some(AURORA_EXT_RATE_LIMIT),
        "connection-limit" => Some(AURORA_EXT_CONN_LIMIT),
        "traffic-shaper" => Some(AURORA_EXT_TRAFFIC_SHAPER),
        "resource-limit" => Some(AURORA_EXT_RESOURCE_LIMIT),
        "traffic-split" => Some(AURORA_EXT_TRAFFIC_SPLIT),
        "canary-release" => Some(AURORA_EXT_CANARY_RELEASE),
        "blue-green" => Some(AURORA_EXT_BLUE_GREEN),
        "request-mirror" => Some(AURORA_EXT_REQUEST_MIRROR),
        "request-termination" => Some(AURORA_EXT_REQUEST_TERMINATION),
        _ => None,
    }
}
