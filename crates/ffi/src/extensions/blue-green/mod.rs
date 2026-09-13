//! Foreign Function Interface (C ABI) for Blue-Green Deployment.
//!
//! Provides C-compatible entry points for NGINX to instantiate and query
//! the in-process blue-green engine. All functions are wrapped
//! in catch_unwind to prevent panics from crossing the foreign function boundary.

use crate::extensions::connection_limit::AuroraHeaderLookupFn;
use aurora_engine::blue_green::{BlueGreenEngine, BlueGreenEvalRequest};
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraUpstreamHeader {
    pub name_len: u32,
    pub name: [u8; 64],
    pub value_len: u32,
    pub value: [u8; 256],
}

impl Default for AuroraUpstreamHeader {
    fn default() -> Self {
        Self {
            name_len: 0,
            name: [0u8; 64],
            value_len: 0,
            value: [0u8; 256],
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraBlueGreenDecision {
    pub matched: u32,
    pub is_header_override: u32,
    pub rule_id_len: u32,
    pub rule_id: [u8; 128],
    pub upstream_len: u32,
    pub upstream: [u8; 128],
    pub active_slot_len: u32,
    pub active_slot: [u8; 16],
    pub headers_count: u32,
    pub headers: [AuroraUpstreamHeader; 16],
}

impl Default for AuroraBlueGreenDecision {
    fn default() -> Self {
        Self {
            matched: 0,
            is_header_override: 0,
            rule_id_len: 0,
            rule_id: [0u8; 128],
            upstream_len: 0,
            upstream: [0u8; 128],
            active_slot_len: 0,
            active_slot: [0u8; 16],
            headers_count: 0,
            headers: [AuroraUpstreamHeader::default(); 16],
        }
    }
}

/// # Safety
/// `data` and `out` must be valid for their declared ranges. The returned
/// engine must be destroyed exactly once with `aurora_blue_green_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_blue_green_create(
    data: *const u8,
    len: usize,
    out: *mut *mut BlueGreenEngine,
) -> u32 {
    if out.is_null() {
        return 1;
    }
    unsafe { *out = ptr::null_mut() };
    if data.is_null() || len == 0 || len > 131_072 {
        return 1;
    }
    match catch_unwind(AssertUnwindSafe(|| {
        BlueGreenEngine::from_snapshot(unsafe { slice::from_raw_parts(data, len) })
    })) {
        Ok(Ok(engine)) => {
            unsafe { *out = Box::into_raw(Box::new(engine)) };
            0
        }
        Ok(Err(_)) => 1,
        Err(_) => 2,
    }
}

/// # Safety
/// The handle must be a live engine returned by `aurora_blue_green_create`, or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_blue_green_destroy(engine: *mut BlueGreenEngine) {
    if !engine.is_null() {
        unsafe { drop(Box::from_raw(engine)) };
    }
}

/// Evaluates a request against configured blue-green deployment rules.
/// Returns 0 on success, 1 on invalid arguments, 2 on internal failure or panic.
///
/// # Safety
/// Pointers must be readable for declared lengths. `out_decision` must be valid for writing.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_blue_green_evaluate(
    engine: *const BlueGreenEngine,
    origin: *const u8,
    origin_len: usize,
    path: *const u8,
    path_len: usize,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    out_decision: *mut AuroraBlueGreenDecision,
) -> u32 {
    if engine.is_null()
        || out_decision.is_null()
        || origin.is_null()
        || origin_len == 0
        || origin_len > 253
        || path.is_null()
        || path_len == 0
        || path_len > 8_192
    {
        return 1;
    }

    match catch_unwind(AssertUnwindSafe(|| {
        let origin_slice = unsafe { slice::from_raw_parts(origin, origin_len) };
        let path_slice = unsafe { slice::from_raw_parts(path, path_len) };

        let header_lookup = |name: &str| -> Option<&[u8]> {
            let f = lookup_fn?;
            let mut val_ptr: *const u8 = ptr::null();
            let mut val_len: usize = 0;
            let rc = unsafe {
                f(
                    lookup_ctx,
                    name.as_ptr(),
                    name.len(),
                    &mut val_ptr,
                    &mut val_len,
                )
            };
            if rc == 0 && !val_ptr.is_null() && val_len > 0 {
                Some(unsafe { slice::from_raw_parts(val_ptr, val_len) })
            } else {
                None
            }
        };

        let eng = unsafe { &*engine };
        let req = BlueGreenEvalRequest {
            origin: origin_slice,
            path: path_slice,
        };

        let decision = eng.evaluate(&req, header_lookup);

        let mut out = AuroraBlueGreenDecision::default();

        if decision.matched {
            out.matched = 1;
            out.is_header_override = if decision.is_header_override { 1 } else { 0 };

            let id_bytes = decision.rule_id.as_bytes();
            let copy_id = id_bytes.len().min(128);
            out.rule_id[..copy_id].copy_from_slice(&id_bytes[..copy_id]);
            out.rule_id_len = copy_id as u32;

            let up_bytes = decision.upstream.as_bytes();
            let copy_up = up_bytes.len().min(128);
            out.upstream[..copy_up].copy_from_slice(&up_bytes[..copy_up]);
            out.upstream_len = copy_up as u32;

            let slot_bytes = decision.active_slot.as_bytes();
            let copy_slot = slot_bytes.len().min(16);
            out.active_slot[..copy_slot].copy_from_slice(&slot_bytes[..copy_slot]);
            out.active_slot_len = copy_slot as u32;

            let mut h_idx = 0;
            for (name, val) in decision.upstream_headers.iter().take(16) {
                let name_bytes = name.as_bytes();
                let copy_name = name_bytes.len().min(64);
                out.headers[h_idx].name[..copy_name].copy_from_slice(&name_bytes[..copy_name]);
                out.headers[h_idx].name_len = copy_name as u32;

                let val_bytes = val.as_bytes();
                let copy_val = val_bytes.len().min(256);
                out.headers[h_idx].value[..copy_val].copy_from_slice(&val_bytes[..copy_val]);
                out.headers[h_idx].value_len = copy_val as u32;

                h_idx += 1;
            }
            out.headers_count = h_idx as u32;
        }

        unsafe { *out_decision = out };
    })) {
        Ok(()) => 0,
        Err(_) => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe extern "C" fn mock_header_lookup(
        _ctx: *mut std::ffi::c_void,
        name: *const u8,
        name_len: usize,
        out_val: *mut *const u8,
        out_val_len: *mut usize,
    ) -> u32 {
        let name_slice = unsafe { slice::from_raw_parts(name, name_len) };
        if name_slice == b"x-deploy-slot" {
            static VAL: &[u8] = b"green";
            unsafe {
                *out_val = VAL.as_ptr();
                *out_val_len = VAL.len();
            }
            0
        } else {
            1
        }
    }

    #[test]
    fn test_blue_green_c_abi_lifecycle_and_eval() {
        let json = br#"{
            "schema_version": 1,
            "rules": [
                {
                    "id": "bg-v1",
                    "priority": 10,
                    "origin": "*",
                    "path_prefix": "/api",
                    "active_slot": "blue",
                    "blue_upstream": "app_blue",
                    "green_upstream": "app_green",
                    "switch_header": "x-deploy-slot",
                    "blue_upstream_headers": [
                        { "name": "x-slot", "value": "blue" }
                    ],
                    "green_upstream_headers": [
                        { "name": "x-slot", "value": "green" }
                    ]
                }
            ]
        }"#;

        unsafe {
            let mut engine: *mut BlueGreenEngine = ptr::null_mut();
            let rc = aurora_blue_green_create(json.as_ptr(), json.len(), &mut engine);
            assert_eq!(rc, 0);
            assert!(!engine.is_null());

            let mut decision = AuroraBlueGreenDecision::default();

            let origin = b"example.com";
            let path = b"/api/v1/resource";

            let eval_rc = aurora_blue_green_evaluate(
                engine,
                origin.as_ptr(),
                origin.len(),
                path.as_ptr(),
                path.len(),
                ptr::null_mut(),
                Some(mock_header_lookup),
                &mut decision,
            );
            assert_eq!(eval_rc, 0);
            assert_eq!(decision.matched, 1);
            assert_eq!(decision.is_header_override, 1);
            assert_eq!(&decision.rule_id[..decision.rule_id_len as usize], b"bg-v1");
            assert_eq!(&decision.upstream[..decision.upstream_len as usize], b"app_green");
            assert_eq!(&decision.active_slot[..decision.active_slot_len as usize], b"green");
            assert_eq!(decision.headers_count, 1);
            assert_eq!(&decision.headers[0].name[..decision.headers[0].name_len as usize], b"x-slot");
            assert_eq!(&decision.headers[0].value[..decision.headers[0].value_len as usize], b"green");

            aurora_blue_green_destroy(engine);
        }
    }
}
