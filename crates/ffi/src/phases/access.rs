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

pub const AURORA_MAX_FORWARD_HEADERS: usize = 16;

/// Generic HTTP header representation for forwarded/injected headers.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AuroraHeader {
    pub name_len: u32,
    pub value_len: u32,
    pub name: [u8; 64],
    pub value: [u8; 256],
}

impl Default for AuroraHeader {
    fn default() -> Self {
        Self {
            name_len: 0,
            value_len: 0,
            name: [0u8; 64],
            value: [0u8; 256],
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

    pub target_upstream_len: u32,
    pub target_upstream: [u8; 128],

    pub rate_limit_bytes_per_sec: u64,

    pub release_token: AuroraReleaseToken,

    pub body_len: u32,
    pub body: [u8; 4096],
    pub content_type_len: u32,
    pub content_type: [u8; 64],
}

impl Default for AuroraAccessOutcome {
    fn default() -> Self {
        Self {
            action: AURORA_ACTION_ALLOW,
            status_code: 200,
            flags: 0,
            headers_count: 0,
            headers: [AuroraHeader::default(); AURORA_MAX_FORWARD_HEADERS],
            target_upstream_len: 0,
            target_upstream: [0u8; 128],
            rate_limit_bytes_per_sec: 0,
            release_token: AuroraReleaseToken::default(),
            body_len: 0,
            body: [0u8; 4096],
            content_type_len: 0,
            content_type: [0u8; 64],
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
        random_seed: in_ref.random_seed,
        now_ms: in_ref.now_ms,
    }
}

#[inline]
fn populate_allow_outcome(
    outcome: &mut AuroraAccessOutcome,
    forwarded_headers: &[(String, String)],
    target_upstream: Option<&str>,
    rate_limit_bytes_per_sec: u64,
    conn_token: Option<ConnectionToken>,
) {
    outcome.action = AURORA_ACTION_ALLOW;
    outcome.status_code = 200;

    let h_count = forwarded_headers.len().min(AURORA_MAX_FORWARD_HEADERS);
    outcome.headers_count = h_count as u32;
    for (i, (name, val)) in forwarded_headers.iter().take(h_count).enumerate() {
        let n_bytes = name.as_bytes();
        let v_bytes = val.as_bytes();
        let n_len = n_bytes.len().min(64);
        let v_len = v_bytes.len().min(256);

        outcome.headers[i].name_len = n_len as u32;
        outcome.headers[i].name[..n_len].copy_from_slice(&n_bytes[..n_len]);

        outcome.headers[i].value_len = v_len as u32;
        outcome.headers[i].value[..v_len].copy_from_slice(&v_bytes[..v_len]);
    }

    if let Some(up) = target_upstream {
        let b = up.as_bytes();
        let len = b.len().min(128);
        outcome.target_upstream_len = len as u32;
        outcome.target_upstream[..len].copy_from_slice(&b[..len]);
    }

    outcome.rate_limit_bytes_per_sec = rate_limit_bytes_per_sec;

    if let Some(tok) = conn_token {
        outcome.flags |= AURORA_FLAG_HAS_RELEASE_TOKEN;
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
    }
}

#[inline]
fn populate_deny_outcome(
    outcome: &mut AuroraAccessOutcome,
    status: u16,
    www_authenticate: bool,
    content_type: Option<&str>,
    body: Option<&[u8]>,
) {
    outcome.action = AURORA_ACTION_DENY;
    outcome.status_code = status as u32;

    if www_authenticate {
        outcome.flags |= AURORA_FLAG_WWW_AUTH;
    }

    if let Some(ct) = content_type {
        let b = ct.as_bytes();
        let len = b.len().min(64);
        outcome.content_type_len = len as u32;
        outcome.content_type[..len].copy_from_slice(&b[..len]);
    }

    if let Some(b) = body {
        let len = b.len().min(4096);
        outcome.body_len = len as u32;
        outcome.body[..len].copy_from_slice(&b[..len]);
    }
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
    out_outcome: *mut AuroraAccessOutcome,
) -> u32 {
    if out_outcome.is_null() {
        return 1;
    }

    if input.is_null() {
        unsafe { ptr::write(out_outcome, AuroraAccessOutcome::default()) };
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

        let space_engines = match crate::lifecycle::get_active_space() {
            Some(space) => space.build_phase_engines(ctx.path),
            None => AccessPhaseEngines::default(),
        };

        let space = AccessPhaseSpace::new(space_engines);
        let decision = space.evaluate(&ctx, header_lookup);

        let mut outcome = AuroraAccessOutcome::default();
        match decision {
            AccessDecision::Allow {
                forwarded_headers,
                target_upstream,
                rate_limit_bytes_per_sec,
                conn_token,
            } => {
                populate_allow_outcome(
                    &mut outcome,
                    &forwarded_headers,
                    target_upstream,
                    rate_limit_bytes_per_sec,
                    conn_token,
                );
            }
            AccessDecision::Deny {
                status,
                www_authenticate,
                content_type,
                body,
            } => {
                populate_deny_outcome(&mut outcome, status, www_authenticate, content_type, body);
            }
        }

        outcome
    }));

    match result {
        Ok(outcome) => {
            unsafe { ptr::write(out_outcome, outcome) };
            0
        }
        Err(_) => 1,
    }
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
