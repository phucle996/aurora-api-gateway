//! HTTP Request Context Abstraction.
//!
//! Provides zero-copy borrowed slices of incoming HTTP requests for policy evaluation.

/// Borrowed, zero-copy HTTP request context passed to gateway evaluators.
#[derive(Clone, Copy, Debug)]
pub struct RequestContext<'a> {
    pub client_ip: &'a [u8],
    pub host: &'a [u8],
    pub path: &'a [u8],
    pub method: &'a [u8],
    pub query: &'a [u8],
    pub content_length: u64,
    pub random_seed: u32,
    pub now_ms: u64,
}

/// Backward compatibility alias.
pub type AccessRequestContext<'a> = RequestContext<'a>;
