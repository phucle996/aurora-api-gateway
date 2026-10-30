//! C-ABI Foreign Function Interface for Gateway Phase 1: HTTP Access Phase.
//!
//! Evaluates security, admission, authentication, limits, and dynamic routing
//! in a single non-blocking execution pass. Returns an actionable `AuroraAccessOutcome`
//! for NGINX to execute (Allow with mutations or Deny with response).

use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

use aurora_engine::{AccessDecision, ConnectionToken, RequestContext};
use aurora_extensions::{AccessPhaseEngines, AccessPhaseSpace};

pub const AURORA_ACTION_ALLOW: u32 = 0;
pub const AURORA_ACTION_DENY: u32 = 1;

pub const AURORA_FLAG_WWW_AUTH: u32 = 1 << 0;
pub const AURORA_FLAG_HAS_RELEASE_TOKEN: u32 = 1 << 1;
pub const AURORA_FLAG_CACHE_PINNED: u32 = 1 << 2;

pub const AURORA_MAX_FORWARD_HEADERS: usize = 16;

/// Generic HTTP header representation for forwarded/injected headers.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraHeader {
    pub name: *const u8,
    pub value: *const u8,
    pub lowcase_name: *const u8,
    pub name_len: u32,
    pub value_len: u32,
}

impl Default for AuroraHeader {
    fn default() -> Self {
        Self {
            name: ptr::null(),
            value: ptr::null(),
            lowcase_name: ptr::null(),
            name_len: 0,
            value_len: 0,
        }
    }
}

pub type AuroraHeaderLookupFn = unsafe extern "C" fn(
    ctx: *mut std::ffi::c_void,
    name: *const u8,
    name_len: usize,
    out_val: *mut *const u8,
    out_val_len: *mut usize,
) -> u32;

/// Memory allocator provided by C host (e.g. `ngx_pnalloc(r->pool, size)`).
/// Allocates uninitialized memory owned by the HTTP request lifecycle.
pub type AuroraAllocFn = unsafe extern "C" fn(
    ctx: *mut std::ffi::c_void,
    size: usize,
) -> *mut u8;

/// Opaque concurrency/rate limiting token passed to NGINX for lifecycle release.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraReleaseToken {
    pub opaque: [u8; 64],
}

impl Default for AuroraReleaseToken {
    fn default() -> Self {
        Self { opaque: [0u8; 64] }
    }
}

/// Incoming HTTP Request Context passed from NGINX at `NGX_HTTP_ACCESS_PHASE`.
#[repr(C)]
pub struct AuroraAccessInput {
    pub client_ip: *const u8,
    pub client_ip_len: usize,
    pub host: *const u8,
    pub host_len: usize,
    pub path: *const u8,
    pub path_len: usize,
    pub method: *const u8,
    pub method_len: usize,
    pub query: *const u8,
    pub query_len: usize,
    pub content_length: u64,
    pub header_length: u64,
    pub random_seed: u32,
    pub now_ms: u64,
}

/// Consolidated Access Phase Outcome executed directly by NGINX.
#[repr(C)]
pub struct AuroraAccessOutcome {
    pub action: u32,
    pub status_code: u32,
    pub flags: u32,
    pub headers_count: u32,

    pub headers: [AuroraHeader; AURORA_MAX_FORWARD_HEADERS],

    pub target_upstream: *const u8,
    pub body: *const u8,
    pub content_type: *const u8,

    pub target_upstream_len: u32,
    pub body_len: u32,
    pub content_type_len: u32,
    pub route_mask: u32,

    pub rate_limit_bytes_per_sec: u64,

    pub release_token: AuroraReleaseToken,
}

impl Default for AuroraAccessOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_ACTION_ALLOW,
            status_code: 200,
            flags: 0,
            headers_count: 0,
            headers: [AuroraHeader::default(); AURORA_MAX_FORWARD_HEADERS],
            target_upstream: ptr::null(),
            body: ptr::null(),
            content_type: ptr::null(),
            target_upstream_len: 0,
            body_len: 0,
            content_type_len: 0,
            route_mask: u32::MAX,
            rate_limit_bytes_per_sec: 0,
            release_token: AuroraReleaseToken::default(),
        }
    }
}

#[inline(always)]
unsafe fn slice_or_default(ptr: *const u8, len: usize, default: &[u8]) -> &[u8] {
    if ptr.is_null() || len == 0 {
        default
    } else {
        unsafe { slice::from_raw_parts(ptr, len) }
    }
}

#[inline]
unsafe fn extract_request_context(in_ref: &AuroraAccessInput) -> RequestContext<'_> {
    RequestContext {
        client_ip: unsafe {
            slice_or_default(in_ref.client_ip, in_ref.client_ip_len, b"127.0.0.1")
        },
        host: unsafe { slice_or_default(in_ref.host, in_ref.host_len, b"localhost") },
        path: unsafe { slice_or_default(in_ref.path, in_ref.path_len, b"/") },
        method: unsafe { slice_or_default(in_ref.method, in_ref.method_len, b"GET") },
        query: unsafe { slice_or_default(in_ref.query, in_ref.query_len, b"") },
        content_length: in_ref.content_length,
        header_length: in_ref.header_length,
        random_seed: in_ref.random_seed,
        now_ms: in_ref.now_ms,
    }
}

#[inline]
unsafe fn populate_allow_outcome(
    outcome: &mut AuroraAccessOutcome,
    forwarded_headers: &[(String, String)],
    target_upstream: Option<&str>,
    rate_limit_bytes_per_sec: u64,
    conn_token: Option<ConnectionToken>,
    alloc_ctx: *mut std::ffi::c_void,
    alloc_fn: Option<AuroraAllocFn>,
) -> Result<(), ()> {
    outcome.action = AURORA_ACTION_ALLOW;
    outcome.status_code = 200;
    outcome.body = ptr::null();
    outcome.body_len = 0;
    outcome.content_type = ptr::null();
    outcome.content_type_len = 0;
    let mut flags = 0u32;

    let h_count = forwarded_headers.len().min(AURORA_MAX_FORWARD_HEADERS);
    outcome.headers_count = h_count as u32;

    for (i, (name, val)) in forwarded_headers.iter().take(h_count).enumerate() {
        let n_bytes = name.as_bytes();
        let v_bytes = val.as_bytes();
        let n_len = n_bytes.len().min(256);
        let v_len = v_bytes.len().min(4096);

        if let Some(allocate) = alloc_fn {
            // Allocate single contiguous buffer in request pool: [name][val][lowcase_name]
            let total = n_len + v_len + n_len;
            let buf = unsafe { allocate(alloc_ctx, total) };
            if buf.is_null() {
                return Err(());
            }

            unsafe {
                ptr::copy_nonoverlapping(n_bytes.as_ptr(), buf, n_len);
                outcome.headers[i].name = buf;
                outcome.headers[i].name_len = n_len as u32;

                let val_buf = buf.add(n_len);
                ptr::copy_nonoverlapping(v_bytes.as_ptr(), val_buf, v_len);
                outcome.headers[i].value = val_buf;
                outcome.headers[i].value_len = v_len as u32;

                let low_buf = val_buf.add(v_len);
                for (j, &b) in n_bytes.iter().take(n_len).enumerate() {
                    *low_buf.add(j) = b.to_ascii_lowercase();
                }
                outcome.headers[i].lowcase_name = low_buf;
            }
        } else {
            outcome.headers[i].name = n_bytes.as_ptr();
            outcome.headers[i].name_len = n_len as u32;
            outcome.headers[i].value = v_bytes.as_ptr();
            outcome.headers[i].value_len = v_len as u32;
            outcome.headers[i].lowcase_name = n_bytes.as_ptr();
        }
    }

    if let Some(up) = target_upstream {
        let b = up.as_bytes();
        let len = b.len().min(256);
        if let Some(allocate) = alloc_fn {
            let buf = unsafe { allocate(alloc_ctx, len) };
            if buf.is_null() {
                return Err(());
            }
            unsafe { ptr::copy_nonoverlapping(b.as_ptr(), buf, len) };
            outcome.target_upstream = buf;
        } else {
            outcome.target_upstream = b.as_ptr();
        }
        outcome.target_upstream_len = len as u32;
    } else {
        outcome.target_upstream = ptr::null();
        outcome.target_upstream_len = 0;
    }

    outcome.rate_limit_bytes_per_sec = rate_limit_bytes_per_sec;

    if let Some(tok) = conn_token {
        flags |= AURORA_FLAG_HAS_RELEASE_TOKEN;
        outcome.release_token.opaque[0] = 1;
        outcome.release_token.opaque[1] = if tok.is_redis { 1 } else { 0 };
        let r_bytes = tok.rule_id.as_bytes();
        let r_len = r_bytes.len().min(30);
        outcome.release_token.opaque[2] = r_len as u8;
        outcome.release_token.opaque[4..4 + r_len].copy_from_slice(&r_bytes[..r_len]);

        let id_bytes = tok.identifier.as_bytes();
        let id_len = id_bytes.len().min(30);
        outcome.release_token.opaque[3] = id_len as u8;
        outcome.release_token.opaque[34..34 + id_len].copy_from_slice(&id_bytes[..id_len]);
    } else {
        outcome.release_token.opaque[0] = 0;
    }

    outcome.flags = flags;
    Ok(())
}

#[inline]
unsafe fn populate_deny_outcome(
    outcome: &mut AuroraAccessOutcome,
    status: u16,
    www_authenticate: bool,
    content_type: Option<&str>,
    body: Option<&[u8]>,
    alloc_ctx: *mut std::ffi::c_void,
    alloc_fn: Option<AuroraAllocFn>,
) -> Result<(), ()> {
    outcome.action = AURORA_ACTION_DENY;
    outcome.status_code = status as u32;
    outcome.flags = u32::from(www_authenticate) * AURORA_FLAG_WWW_AUTH;
    outcome.headers_count = 0;
    outcome.target_upstream = ptr::null();
    outcome.target_upstream_len = 0;
    outcome.rate_limit_bytes_per_sec = 0;
    outcome.release_token.opaque[0] = 0;

    if let Some(ct) = content_type {
        let b = ct.as_bytes();
        let len = b.len().min(256);
        if let Some(allocate) = alloc_fn {
            let buf = unsafe { allocate(alloc_ctx, len) };
            if buf.is_null() {
                return Err(());
            }
            unsafe { ptr::copy_nonoverlapping(b.as_ptr(), buf, len) };
            outcome.content_type = buf;
        } else {
            outcome.content_type = b.as_ptr();
        }
        outcome.content_type_len = len as u32;
    } else {
        outcome.content_type = ptr::null();
        outcome.content_type_len = 0;
    }

    if let Some(b) = body {
        let len = b.len().min(65536);
        if let Some(allocate) = alloc_fn {
            let buf = unsafe { allocate(alloc_ctx, len) };
            if buf.is_null() {
                return Err(());
            }
            unsafe { ptr::copy_nonoverlapping(b.as_ptr(), buf, len) };
            outcome.body = buf;
        } else {
            outcome.body = b.as_ptr();
        }
        outcome.body_len = len as u32;
    } else {
        outcome.body = ptr::null();
        outcome.body_len = 0;
    }
    Ok(())
}

#[inline]
unsafe fn populate_cache_hit_outcome(
    outcome: &mut AuroraAccessOutcome,
    hit: aurora_extensions::response_cache::CacheHitOutcome,
    alloc_ctx: *mut std::ffi::c_void,
    alloc_fn: Option<AuroraAllocFn>,
) -> u32 {
    outcome.action = AURORA_ACTION_DENY;
    outcome.status_code = hit.status as u32;
    outcome.flags = AURORA_FLAG_CACHE_PINNED;
    outcome.target_upstream = ptr::null();
    outcome.target_upstream_len = 0;
    outcome.rate_limit_bytes_per_sec = 0;

    let ct_bytes = hit.content_type.as_bytes();
    let ct_len = ct_bytes.len().min(256);
    if let Some(allocate) = alloc_fn {
        let buf = unsafe { allocate(alloc_ctx, ct_len) };
        if buf.is_null() {
            return 1;
        }
        unsafe { ptr::copy_nonoverlapping(ct_bytes.as_ptr(), buf, ct_len) };
        outcome.content_type = buf;
    } else {
        outcome.content_type = ct_bytes.as_ptr();
    }
    outcome.content_type_len = ct_len as u32;

    // Zero-copy body pointer handover with pinned Arc
    let raw_arc = std::sync::Arc::into_raw(hit.body);
    outcome.body = unsafe { (*raw_arc).as_ptr() };
    outcome.body_len = unsafe { (*raw_arc).len() } as u32;

    let ptr_val = raw_arc as usize;
    outcome.release_token.opaque[..std::mem::size_of::<usize>()]
        .copy_from_slice(&ptr_val.to_ne_bytes());

    let h_count = hit.headers.len().min(AURORA_MAX_FORWARD_HEADERS);
    outcome.headers_count = h_count as u32;
    for (i, (name, val)) in hit.headers.iter().take(h_count).enumerate() {
        let n_bytes = name.as_bytes();
        let v_bytes = val.as_bytes();
        let n_len = n_bytes.len().min(256);
        let v_len = v_bytes.len().min(4096);

        if let Some(allocate) = alloc_fn {
            let total = n_len + v_len + n_len;
            let buf = unsafe { allocate(alloc_ctx, total) };
            if buf.is_null() {
                unsafe { drop(std::sync::Arc::from_raw(raw_arc)) };
                return 1;
            }
            unsafe {
                ptr::copy_nonoverlapping(n_bytes.as_ptr(), buf, n_len);
                outcome.headers[i].name = buf;
                outcome.headers[i].name_len = n_len as u32;

                let val_buf = buf.add(n_len);
                ptr::copy_nonoverlapping(v_bytes.as_ptr(), val_buf, v_len);
                outcome.headers[i].value = val_buf;
                outcome.headers[i].value_len = v_len as u32;

                let low_buf = val_buf.add(v_len);
                for (j, &b) in n_bytes.iter().take(n_len).enumerate() {
                    *low_buf.add(j) = b.to_ascii_lowercase();
                }
                outcome.headers[i].lowcase_name = low_buf;
            }
        } else {
            outcome.headers[i].name = n_bytes.as_ptr();
            outcome.headers[i].name_len = n_len as u32;
            outcome.headers[i].value = v_bytes.as_ptr();
            outcome.headers[i].value_len = v_len as u32;
            outcome.headers[i].lowcase_name = n_bytes.as_ptr();
        }
    }

    0
}

/// Evaluates Phase 1: HTTP Access Phase for incoming request.
///
/// Executes Gateway Phase 1: HTTP Access Phase.
/// Evaluates route trie matching and the active extensions for this route.
///
/// # Safety
/// `input` must point to a valid initialized struct.
/// `out_outcome` must point to writable memory for `AuroraAccessOutcome`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_phase_access(
    input: *const AuroraAccessInput,
    lookup_ctx: *mut std::ffi::c_void,
    lookup_fn: Option<AuroraHeaderLookupFn>,
    alloc_fn: Option<AuroraAllocFn>,
    out_outcome: *mut AuroraAccessOutcome,
) -> u32 {
    if out_outcome.is_null() {
        return 1;
    }

    if input.is_null() {
        unsafe {
            let out = &mut *out_outcome;
            out.action = AURORA_ACTION_ALLOW;
            out.status_code = 200;
            out.flags = 0;
            out.headers_count = 0;
            out.target_upstream = ptr::null();
            out.target_upstream_len = 0;
            out.rate_limit_bytes_per_sec = 0;
            out.body = ptr::null();
            out.body_len = 0;
            out.content_type = ptr::null();
            out.content_type_len = 0;
            out.route_mask = u32::MAX;
            out.release_token.opaque[0] = 0;
        }
        return 0;
    }

    let in_ref = unsafe { &*input };

    let result = catch_unwind(AssertUnwindSafe(|| {
        let ctx = unsafe { extract_request_context(in_ref) };

        let header_lookup = |name: &str| -> Option<&[u8]> {
            let func = lookup_fn?;
            let mut val_ptr: *const u8 = ptr::null();
            let mut val_len: usize = 0;
            let rc = unsafe {
                func(
                    lookup_ctx,
                    name.as_ptr(),
                    name.len(),
                    &mut val_ptr,
                    &mut val_len,
                )
            };
            if rc == 0 && !val_ptr.is_null() && val_len <= 16_384 {
                Some(unsafe { slice::from_raw_parts(val_ptr, val_len) })
            } else {
                None
            }
        };

        let active_space_opt = crate::lifecycle::get_active_space();
        let (route_mask, space_engines) = match active_space_opt.as_ref() {
            Some(space) => (
                space.resolve_route_mask(ctx.path),
                space.build_phase_engines(ctx.path),
            ),
            None => (u32::MAX, AccessPhaseEngines::default()),
        };

        let space = AccessPhaseSpace::new(space_engines);
        let decision = space.evaluate(&ctx, header_lookup);

        let out = unsafe { &mut *out_outcome };
        out.route_mask = route_mask;
        let res = match decision {
            AccessDecision::Allow {
                forwarded_headers,
                target_upstream,
                rate_limit_bytes_per_sec,
                conn_token,
            } => {
                // If admission/security passed and route enables Response Cache, check in-memory cache
                if (route_mask & (1 << crate::lifecycle::AURORA_EXT_RESPONSE_CACHE)) != 0
                    && let Some(active_space) = active_space_opt.as_ref()
                    && let Some(cache) = active_space.response_cache.as_deref()
                {
                    let ae = header_lookup("accept-encoding");
                    let cc = header_lookup("cache-control");
                    if let aurora_extensions::response_cache::CacheLookupResult::Hit(hit) =
                        cache.evaluate_access(&ctx, ae, cc)
                    {
                        return unsafe {
                            populate_cache_hit_outcome(out, hit, lookup_ctx, alloc_fn)
                        };
                    }
                }

                unsafe {
                    populate_allow_outcome(
                        out,
                        forwarded_headers.as_deref().unwrap_or(&[]),
                        target_upstream,
                        rate_limit_bytes_per_sec,
                        conn_token,
                        lookup_ctx,
                        alloc_fn,
                    )
                }
            }
            AccessDecision::Deny {
                status,
                www_authenticate,
                content_type,
                body,
            } => unsafe {
                populate_deny_outcome(
                    out,
                    status,
                    www_authenticate,
                    content_type,
                    body,
                    lookup_ctx,
                    alloc_fn,
                )
            },
        };

        if res.is_err() {
            1
        } else {
            0
        }
    }));

    result.unwrap_or(1)
}

/// Releases an acquired concurrency slot identified by the opaque `AuroraReleaseToken`.
///
/// # Safety
/// `token` must point to a readable `AuroraReleaseToken`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aurora_gateway_connection_release(token: *const AuroraReleaseToken) {
    if token.is_null() {
        return;
    }
    let t = unsafe { &*token };
    if t.opaque[0] == 0 || t.opaque[1] != 0 {
        return;
    }
    let r_len = (t.opaque[2] as usize).min(30);
    let id_len = (t.opaque[3] as usize).min(30);
    let rule_id = std::str::from_utf8(&t.opaque[4..4 + r_len]).unwrap_or("");
    let identifier = t.opaque[34..34 + id_len].to_vec();

    if let Some(eng) =
        crate::lifecycle::get_active_space().and_then(|space| space.connection_limit.as_ref())
    {
        let conn_token = aurora_extensions::connection_limit::ConnLimitToken {
            rule_id: rule_id.to_string(),
            identifier,
            is_redis: false,
        };
        eng.release(&conn_token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_abi_struct_layout_and_size() {
        assert_eq!(std::mem::size_of::<AuroraHeader>(), 32);
        assert_eq!(std::mem::align_of::<AuroraHeader>(), 8);
        assert_eq!(std::mem::size_of::<AuroraAccessOutcome>(), 640);
        assert_eq!(std::mem::align_of::<AuroraAccessOutcome>(), 8);
    }

    unsafe extern "C" fn mock_alloc(ctx: *mut std::ffi::c_void, size: usize) -> *mut u8 {
        let arena = unsafe { &mut *(ctx as *mut Vec<u8>) };
        let current_len = arena.len();
        arena.resize(current_len + size, 0);
        unsafe { arena.as_mut_ptr().add(current_len) }
    }

    #[test]
    fn test_populate_allow_outcome_with_alloc_fn() {
        let mut outcome = AuroraAccessOutcome::default();
        let mut arena = Vec::<u8>::new();
        let alloc_ctx = &mut arena as *mut Vec<u8> as *mut std::ffi::c_void;

        let headers = vec![
            ("X-Custom-Auth".to_string(), "token-12345".to_string()),
            ("X-Tenant".to_string(), "finance".to_string()),
        ];

        let res = unsafe {
            populate_allow_outcome(
                &mut outcome,
                &headers,
                Some("upstream-cluster-a"),
                100_000,
                None,
                alloc_ctx,
                Some(mock_alloc),
            )
        };
        assert!(res.is_ok());
        assert_eq!(outcome.action, AURORA_ACTION_ALLOW);
        assert_eq!(outcome.headers_count, 2);
        assert_eq!(outcome.target_upstream_len, 18);

        unsafe {
            let h0_name = slice::from_raw_parts(outcome.headers[0].name, outcome.headers[0].name_len as usize);
            assert_eq!(h0_name, b"X-Custom-Auth");
            let h0_val = slice::from_raw_parts(outcome.headers[0].value, outcome.headers[0].value_len as usize);
            assert_eq!(h0_val, b"token-12345");
            let h0_low = slice::from_raw_parts(outcome.headers[0].lowcase_name, outcome.headers[0].name_len as usize);
            assert_eq!(h0_low, b"x-custom-auth");

            let up = slice::from_raw_parts(outcome.target_upstream, outcome.target_upstream_len as usize);
            assert_eq!(up, b"upstream-cluster-a");
        }
    }

    #[test]
    fn test_per_route_extension_bitmask_isolation() {
        let mut trie = aurora_engine::PathRadixTree::new();
        let global_mask = (1 << crate::lifecycle::AURORA_EXT_IP_RESTRICTION)
            | (1 << crate::lifecycle::AURORA_EXT_RESPONSE_COMPRESSION)
            | (1 << crate::lifecycle::AURORA_EXT_RESPONSE_CACHE);

        trie.insert(b"/", global_mask);
        // Route /api/v1/public: explicit cache + compression only (no IP restriction)
        trie.insert(
            b"/api/v1/public",
            (1 << crate::lifecycle::AURORA_EXT_RESPONSE_COMPRESSION)
                | (1 << crate::lifecycle::AURORA_EXT_RESPONSE_CACHE),
        );
        // Route /api/v1/raw: explicit passthrough (0 extensions)
        trie.insert(b"/api/v1/raw", 0);

        let space = crate::lifecycle::GatewayActiveSpace {
            route_trie: trie,
            ..Default::default()
        };

        assert_eq!(space.resolve_route_mask(b"/other"), global_mask);
        assert_eq!(
            space.resolve_route_mask(b"/api/v1/public/items"),
            (1 << crate::lifecycle::AURORA_EXT_RESPONSE_COMPRESSION)
                | (1 << crate::lifecycle::AURORA_EXT_RESPONSE_CACHE)
        );
        assert_eq!(space.resolve_route_mask(b"/api/v1/raw/webhook"), 0);
    }
}

