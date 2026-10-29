//! Gateway In-Process Policy Registry & Active Phase Space Lifecycle.
//!
//! Owns the active extension engines, dynamic Shared Memory (SHM) policy synchronization,
//! and Route Radix Trie matching. Completely abstracts extension details away from
//! external adapters (e.g. NGINX C module), enabling a clean, phase-only execution boundary.

use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
    sync::{
        Arc,
        atomic::{AtomicPtr, AtomicU64, Ordering},
    },
};

use aurora_engine::PathRadixTree;
use aurora_extensions::{
    AccessPhaseEngines, BlueGreenEngine, CanaryReleaseEngine, ConnectionLimitEngine,
    IpRestrictionEngine, JwtEngine, RateLimitEngine, RequestMirrorEngine, RequestTerminationEngine,
    ResourceLimiter, TrafficShaperEngine, TrafficSplitEngine,
};

pub const AURORA_EXT_IP_RESTRICTION: usize = 0;
pub const AURORA_EXT_JWT: usize = 1;
pub const AURORA_EXT_RATE_LIMIT: usize = 2;
pub const AURORA_EXT_CONN_LIMIT: usize = 3;
pub const AURORA_EXT_TRAFFIC_SHAPER: usize = 4;
pub const AURORA_EXT_RESOURCE_LIMIT: usize = 5;
pub const AURORA_EXT_TRAFFIC_SPLIT: usize = 6;
pub const AURORA_EXT_CANARY_RELEASE: usize = 7;
pub const AURORA_EXT_BLUE_GREEN: usize = 8;
pub const AURORA_EXT_REQUEST_MIRROR: usize = 9;
pub const AURORA_EXT_REQUEST_TERMINATION: usize = 10;
pub const AURORA_EXT_COUNT: usize = 11;

/// Active policy space holding live engines and route trie.
#[derive(Default, Clone)]
pub struct GatewayActiveSpace {
    pub ip_restriction: Option<Arc<IpRestrictionEngine>>,
    pub jwt: Option<Arc<JwtEngine>>,
    pub rate_limit: Option<Arc<RateLimitEngine>>,
    pub connection_limit: Option<Arc<ConnectionLimitEngine>>,
    pub traffic_shaper: Option<Arc<TrafficShaperEngine>>,
    pub resource_limit: Option<Arc<ResourceLimiter>>,
    pub traffic_split: Option<Arc<TrafficSplitEngine>>,
    pub canary_release: Option<Arc<CanaryReleaseEngine>>,
    pub blue_green: Option<Arc<BlueGreenEngine>>,
    pub request_mirror: Option<Arc<RequestMirrorEngine>>,
    pub request_termination: Option<Arc<RequestTerminationEngine>>,
    pub generations: [u64; AURORA_EXT_COUNT],
    pub route_trie: PathRadixTree<u32>,
}

impl GatewayActiveSpace {
    /// Builds `AccessPhaseEngines` for the matching route trie path prefix.
    pub fn build_phase_engines<'a>(&'a self, path: &[u8]) -> AccessPhaseEngines<'a> {
        let mut engines = AccessPhaseEngines::default();
        let mask = self
            .route_trie
            .find_best(path, |_| true, |_| 0)
            .copied()
            .unwrap_or(u32::MAX);

        if mask & (1 << AURORA_EXT_IP_RESTRICTION) != 0 {
            engines.ip_restriction = self.ip_restriction.as_deref();
        }
        if mask & (1 << AURORA_EXT_JWT) != 0 {
            engines.jwt = self.jwt.as_deref();
        }
        if mask & (1 << AURORA_EXT_RATE_LIMIT) != 0 {
            engines.rate_limit = self.rate_limit.as_deref();
        }
        if mask & (1 << AURORA_EXT_CONN_LIMIT) != 0 {
            engines.connection_limit = self.connection_limit.as_deref();
        }
        if mask & (1 << AURORA_EXT_TRAFFIC_SHAPER) != 0 {
            engines.traffic_shaper = self.traffic_shaper.as_deref();
        }
        if mask & (1 << AURORA_EXT_RESOURCE_LIMIT) != 0 {
            engines.resource_limit = self.resource_limit.as_deref();
        }
        if mask & (1 << AURORA_EXT_REQUEST_TERMINATION) != 0 {
            engines.request_termination = self.request_termination.as_deref();
        }
        if mask & (1 << AURORA_EXT_TRAFFIC_SPLIT) != 0 {
            engines.traffic_split = self.traffic_split.as_deref();
        }
        if mask & (1 << AURORA_EXT_CANARY_RELEASE) != 0 {
            engines.canary_release = self.canary_release.as_deref();
        }
        if mask & (1 << AURORA_EXT_BLUE_GREEN) != 0 {
            engines.blue_green = self.blue_green.as_deref();
        }
        if mask & (1 << AURORA_EXT_REQUEST_MIRROR) != 0 {
            engines.request_mirror = self.request_mirror.as_deref();
        }

        engines
    }
}

static ACTIVE_SPACE: AtomicPtr<GatewayActiveSpace> = AtomicPtr::new(ptr::null_mut());
static LAST_SYNC_GEN: AtomicU64 = AtomicU64::new(0);

/// Retrieves a reference to the currently active policy space, if loaded.
#[inline(always)]
pub fn get_active_space() -> Option<&'static GatewayActiveSpace> {
    let p = ACTIVE_SPACE.load(Ordering::Acquire);
    if p.is_null() {
        None
    } else {
        Some(unsafe { &*p })
    }
}

/// Atomically replaces the active policy space.
pub fn set_active_space(space: GatewayActiveSpace) {
    let new_ptr = Box::into_raw(Box::new(space));
    let old = ACTIVE_SPACE.swap(new_ptr, Ordering::AcqRel);
    if !old.is_null() {
        unsafe { drop(Box::from_raw(old)) };
    }
}

/// Synchronizes active policy slots from Policy Shared Memory into Rust's active space.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_policy_sync() {
    let total_gen = crate::shm::aurora_gateway_policy_generation();
    let last_gen = LAST_SYNC_GEN.load(Ordering::Acquire);
    if total_gen == last_gen && !ACTIVE_SPACE.load(Ordering::Acquire).is_null() {
        return;
    }

    let current = get_active_space().cloned().unwrap_or_default();
    let mut next = current;
    let mut changed = false;

    for slot_id in 0..AURORA_EXT_COUNT {
        let mut slot_gen = 0u64;
        let mut len = 0usize;
        let data = unsafe {
            crate::shm::aurora_gateway_policy_slot_get(slot_id as u32, &mut slot_gen, &mut len)
        };

        if slot_gen == next.generations[slot_id] && !ACTIVE_SPACE.load(Ordering::Acquire).is_null()
        {
            continue;
        }

        changed = true;
        next.generations[slot_id] = slot_gen;

        if len == 0 || data.is_null() {
            match slot_id {
                AURORA_EXT_IP_RESTRICTION => next.ip_restriction = None,
                AURORA_EXT_JWT => next.jwt = None,
                AURORA_EXT_RATE_LIMIT => next.rate_limit = None,
                AURORA_EXT_CONN_LIMIT => next.connection_limit = None,
                AURORA_EXT_TRAFFIC_SHAPER => next.traffic_shaper = None,
                AURORA_EXT_RESOURCE_LIMIT => next.resource_limit = None,
                AURORA_EXT_TRAFFIC_SPLIT => next.traffic_split = None,
                AURORA_EXT_CANARY_RELEASE => next.canary_release = None,
                AURORA_EXT_BLUE_GREEN => next.blue_green = None,
                AURORA_EXT_REQUEST_MIRROR => next.request_mirror = None,
                AURORA_EXT_REQUEST_TERMINATION => next.request_termination = None,
                _ => {}
            }
        } else {
            let bytes = unsafe { slice::from_raw_parts(data, len) };
            match slot_id {
                AURORA_EXT_IP_RESTRICTION => {
                    if let Ok(eng) = IpRestrictionEngine::from_snapshot(bytes) {
                        next.ip_restriction = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_JWT => {
                    if let Ok(eng) = JwtEngine::from_snapshot(bytes) {
                        next.jwt = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_RATE_LIMIT => {
                    if let Ok(eng) = RateLimitEngine::from_snapshot(bytes) {
                        next.rate_limit = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_CONN_LIMIT => {
                    if let Ok(eng) = ConnectionLimitEngine::from_snapshot(bytes) {
                        next.connection_limit = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_TRAFFIC_SHAPER => {
                    if let Ok(eng) = TrafficShaperEngine::from_snapshot(bytes) {
                        next.traffic_shaper = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_RESOURCE_LIMIT => {
                    if let Ok(eng) = ResourceLimiter::from_snapshot(bytes) {
                        next.resource_limit = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_TRAFFIC_SPLIT => {
                    if let Ok(eng) = TrafficSplitEngine::from_snapshot(bytes) {
                        next.traffic_split = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_CANARY_RELEASE => {
                    if let Ok(eng) = CanaryReleaseEngine::from_snapshot(bytes) {
                        next.canary_release = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_BLUE_GREEN => {
                    if let Ok(eng) = BlueGreenEngine::from_snapshot(bytes) {
                        next.blue_green = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_REQUEST_MIRROR => {
                    if let Ok(eng) = RequestMirrorEngine::from_snapshot(bytes) {
                        next.request_mirror = Some(Arc::new(eng));
                    }
                }
                AURORA_EXT_REQUEST_TERMINATION => {
                    if let Ok(eng) = RequestTerminationEngine::from_snapshot(bytes) {
                        next.request_termination = Some(Arc::new(eng));
                    }
                }
                _ => {}
            }
        }
    }

    if changed || ACTIVE_SPACE.load(Ordering::Acquire).is_null() {
        let mut trie = PathRadixTree::new();
        let mut active_mask: u32 = 0;
        if next.ip_restriction.is_some() {
            active_mask |= 1 << AURORA_EXT_IP_RESTRICTION;
        }
        if next.jwt.is_some() {
            active_mask |= 1 << AURORA_EXT_JWT;
        }
        if next.rate_limit.is_some() {
            active_mask |= 1 << AURORA_EXT_RATE_LIMIT;
        }
        if next.connection_limit.is_some() {
            active_mask |= 1 << AURORA_EXT_CONN_LIMIT;
        }
        if next.traffic_shaper.is_some() {
            active_mask |= 1 << AURORA_EXT_TRAFFIC_SHAPER;
        }
        if next.resource_limit.is_some() {
            active_mask |= 1 << AURORA_EXT_RESOURCE_LIMIT;
        }
        if next.traffic_split.is_some() {
            active_mask |= 1 << AURORA_EXT_TRAFFIC_SPLIT;
        }
        if next.canary_release.is_some() {
            active_mask |= 1 << AURORA_EXT_CANARY_RELEASE;
        }
        if next.blue_green.is_some() {
            active_mask |= 1 << AURORA_EXT_BLUE_GREEN;
        }
        if next.request_mirror.is_some() {
            active_mask |= 1 << AURORA_EXT_REQUEST_MIRROR;
        }
        if next.request_termination.is_some() {
            active_mask |= 1 << AURORA_EXT_REQUEST_TERMINATION;
        }

        trie.insert(b"/", active_mask);
        next.route_trie = trie;

        set_active_space(next);
        LAST_SYNC_GEN.store(total_gen, Ordering::Release);
    }
}

/// Initializes process-level substrates: Policy SHM, Shadow Worker thread, and initial policy sync.
///
/// # Safety
/// Called once per worker process during `init_process`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_process_init(worker_id: u32) -> u32 {
    let shm_rc = unsafe { crate::shm::aurora_gateway_init_policy_shm(ptr::null()) };
    let shadow_rc = unsafe { crate::shadow::aurora_gateway_shadow_start(worker_id) };
    aurora_gateway_policy_sync();
    if shm_rc == 0 && shadow_rc == 0 { 0 } else { 1 }
}

/// Shuts down process-level substrates: Shadow Worker, Policy SHM, and drops active policy space.
///
/// # Safety
/// Called once per worker process during `exit_process`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_process_exit() {
    let _ = unsafe { crate::shadow::aurora_gateway_shadow_stop() };
    crate::shm::aurora_gateway_stop_policy_shm();
    let old = ACTIVE_SPACE.swap(ptr::null_mut(), Ordering::AcqRel);
    if !old.is_null() {
        unsafe { drop(Box::from_raw(old)) };
    }
}

/// Probes and returns host OS kernel network acceleration capabilities bitmap.
#[unsafe(no_mangle)]
pub extern "C" fn aurora_gateway_probe_kernel() -> u32 {
    aurora_engine::kernel::probe_kernel_capabilities().raw
}

/// Generic polymorphic extension constructor.
///
/// Instantiates an extension engine directly from its declarative JSON snapshot bytes.
///
/// # Safety
/// `data` must point to `len` readable bytes. `out` must be non-null and valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_extension_create(
    ext_id: u32,
    data: *const u8,
    len: usize,
    out: *mut *mut std::ffi::c_void,
) -> u32 {
    if data.is_null() || len == 0 || out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    let bytes = unsafe { slice::from_raw_parts(data, len) };

    match ext_id as usize {
        AURORA_EXT_IP_RESTRICTION => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::IpRestrictionEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_JWT => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::JwtEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_RATE_LIMIT => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::RateLimitEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_CONN_LIMIT => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::ConnectionLimitEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_TRAFFIC_SHAPER => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::TrafficShaperEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_RESOURCE_LIMIT => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::ResourceLimiter::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_TRAFFIC_SPLIT => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::TrafficSplitEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_CANARY_RELEASE => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::CanaryReleaseEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_BLUE_GREEN => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::BlueGreenEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_REQUEST_MIRROR => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::RequestMirrorEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        AURORA_EXT_REQUEST_TERMINATION => match catch_unwind(AssertUnwindSafe(|| {
            aurora_extensions::RequestTerminationEngine::from_snapshot(bytes)
        })) {
            Ok(Ok(engine)) => {
                unsafe { *out = Box::into_raw(Box::new(engine)).cast() };
                0
            }
            _ => 1,
        },
        _ => 1,
    }
}

/// Generic polymorphic extension destructor.
///
/// # Safety
/// `engine` may be null (no-op) or must be a valid pointer created by `aurora_gateway_extension_create`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_extension_destroy(
    ext_id: u32,
    engine: *mut std::ffi::c_void,
) {
    if engine.is_null() {
        return;
    }
    match ext_id as usize {
        AURORA_EXT_IP_RESTRICTION => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::IpRestrictionEngine,
            ));
        },
        AURORA_EXT_JWT => unsafe {
            drop(Box::from_raw(engine as *mut aurora_extensions::JwtEngine));
        },
        AURORA_EXT_RATE_LIMIT => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::RateLimitEngine,
            ));
        },
        AURORA_EXT_CONN_LIMIT => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::ConnectionLimitEngine,
            ));
        },
        AURORA_EXT_TRAFFIC_SHAPER => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::TrafficShaperEngine,
            ));
        },
        AURORA_EXT_RESOURCE_LIMIT => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::ResourceLimiter,
            ));
        },
        AURORA_EXT_TRAFFIC_SPLIT => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::TrafficSplitEngine,
            ));
        },
        AURORA_EXT_CANARY_RELEASE => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::CanaryReleaseEngine,
            ));
        },
        AURORA_EXT_BLUE_GREEN => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::BlueGreenEngine,
            ));
        },
        AURORA_EXT_REQUEST_MIRROR => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::RequestMirrorEngine,
            ));
        },
        AURORA_EXT_REQUEST_TERMINATION => unsafe {
            drop(Box::from_raw(
                engine as *mut aurora_extensions::RequestTerminationEngine,
            ));
        },
        _ => {}
    }
}
