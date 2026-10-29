//! In-process JWT authorization for the NGINX access phase.
//!
//! Features:
//! - Origin-First Scoping: Each Origin (Domain/Host) represents an Upstream Backend.
//! - Default-Deny with `exclude_paths` bypass whitelist.
//! - Multi-Algorithm: Symmetric (HS256/384/512) and Asymmetric (RS256/384/512, ES256/384, EdDSA).
//! - Zero-downtime Key Rotation via Key Ring with O(1) `kid` lookup.
//! - 64-way lock-striped unified sheet cache (`JwtCache`) eliminating CPU cache-line false sharing.
//! - Single-probe (~7-10ns) state evaluation with 1-cycle in-place revocation bit flipping.
//! - SIMD dot hunting (`memchr`) and stack-allocated zero-allocation hot path.
//! - Nested claims extraction (dot notation) and array joining.

pub mod cache;
pub mod crypto;
mod engine;
pub(crate) mod exclude;
pub mod redis_sync;
mod types;

#[cfg(test)]
mod tests;

pub use cache::{
    CacheLookup, CacheRow, JwtCache, TOKEN_STATUS_NEGATIVE, TOKEN_STATUS_POSITIVE,
    empty_forwarded_headers,
};
pub use crypto::{
    JwtAlgorithm, VerifiedPayload, VerifierKey, resolve_claim_path_cow, verify_jwt,
};
pub use engine::JwtEngine;
pub use types::{
    JwtDecision, MAX_AUTHORIZATION_BYTES, MAX_EXCLUDE_PATHS_PER_ORIGIN,
    MAX_FORWARD_HEADERS_PER_ORIGIN, MAX_JWT_KEYS_PER_ORIGIN, MAX_JWT_ORIGINS,
    MAX_JWT_POLICY_BYTES, PayloadFormat, TokenSource,
};
