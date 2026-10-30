//! C-ABI Foreign Function Interface for Gateway Response Caching & Memory Lifecycle.

use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    slice,
    sync::Arc,
};

/// Input structure passed from NGINX body filter to store an upstream response.
#[repr(C)]
pub struct AuroraCacheStoreInput {
    pub method: *const u8,
    pub method_len: usize,
    pub host: *const u8,
    pub host_len: usize,
    pub path: *const u8,
    pub path_len: usize,
    pub query: *const u8,
    pub query_len: usize,
    pub status: u32,
    pub content_type: *const u8,
    pub content_type_len: usize,
    pub body: *const u8,
    pub body_len: usize,
    pub cache_control: *const u8,
    pub cache_control_len: usize,
    pub etag: *const u8,
    pub etag_len: usize,
}

/// Releases a pinned cache entry buffer when NGINX destroys the HTTP request pool.
///
/// # Safety
/// `data` must be a valid pointer created via `Arc::into_raw` from an `Arc<Vec<u8>>`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_release_cache_entry(data: *mut std::ffi::c_void) {
    if !data.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            drop(Arc::from_raw(data as *const Vec<u8>));
        }));
    }
}

/// Stores an upstream HTTP response into the in-memory response cache.
///
/// # Safety
/// `input` must point to a valid initialized `AuroraCacheStoreInput` struct.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_phase_cache_store(
    input: *const AuroraCacheStoreInput,
) -> u32 {
    if input.is_null() {
        return 1;
    }

    let res = catch_unwind(AssertUnwindSafe(|| {
        let in_ref = unsafe { &*input };
        let space = match crate::lifecycle::get_active_space() {
            Some(s) => s,
            None => return 0,
        };

        let cache = match space.response_cache.as_deref() {
            Some(c) => c,
            None => return 0,
        };

        let method = unsafe { slice_or_empty(in_ref.method, in_ref.method_len) };
        let host = unsafe { slice_or_empty(in_ref.host, in_ref.host_len) };
        let path = unsafe { slice_or_empty(in_ref.path, in_ref.path_len) };
        let route_mask = space.resolve_route_mask(path);
        if (route_mask & (1 << crate::lifecycle::AURORA_EXT_RESPONSE_CACHE)) == 0 {
            return 0;
        }
        let query = unsafe { slice_or_empty(in_ref.query, in_ref.query_len) };
        let ct_slice = unsafe { slice_or_empty(in_ref.content_type, in_ref.content_type_len) };
        let content_type = std::str::from_utf8(ct_slice).unwrap_or("application/octet-stream");
        let body = unsafe { slice_or_empty(in_ref.body, in_ref.body_len) };

        let cc_opt = if in_ref.cache_control.is_null() || in_ref.cache_control_len == 0 {
            None
        } else {
            Some(unsafe { slice::from_raw_parts(in_ref.cache_control, in_ref.cache_control_len) })
        };

        let mut headers = Vec::new();
        if !in_ref.etag.is_null()
            && in_ref.etag_len > 0
            && let Ok(etag_str) = std::str::from_utf8(unsafe {
                slice::from_raw_parts(in_ref.etag, in_ref.etag_len)
            })
        {
            headers.push(("ETag".to_string(), etag_str.to_string()));
        }

        let record = aurora_extensions::response_cache::evaluator::UpstreamResponseRecord {
            method,
            host,
            path,
            query,
            status: in_ref.status as u16,
            content_type,
            headers: &headers,
            body,
            cache_control: cc_opt,
        };

        cache.store_response(&record);

        0
    }));

    res.unwrap_or(1)
}

#[inline(always)]
unsafe fn slice_or_empty(ptr: *const u8, len: usize) -> &'static [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { slice::from_raw_parts(ptr, len) }
    }
}
