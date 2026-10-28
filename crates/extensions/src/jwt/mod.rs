//! In-process JWT authorization for the NGINX access phase.
//!
//! Features:
//! - Origin-First Scoping: Each Origin (Domain/Host) represents an Upstream Backend.
//! - Default-Deny with `exclude_paths` bypass whitelist.
//! - Multi-Algorithm: Symmetric (HS256/384/512) and Asymmetric (RS256/384/512, ES256/384, EdDSA).
//! - Zero-downtime Key Rotation via Key Ring with O(1) `kid` lookup.
//! - 64-way lock-striped dual cache (`JwtCache`) eliminating CPU cache-line false sharing.
//! - SIMD dot hunting (`memchr`) and stack-allocated zero-allocation hot path.
//! - Nested claims extraction (dot notation) and array joining.

pub mod cache;
pub mod crypto;
mod engine;
pub(crate) mod exclude;
mod types;

#[cfg(test)]
mod tests;

pub use cache::JwtCache;
pub use crypto::{
    JwtAlgorithm, VerifierKey, resolve_claim_path, resolve_claim_path_cow, verify_jwt,
};
pub use engine::JwtEngine;
pub use types::{
    ForwardedHeader, JwtDecision, MAX_AUTHORIZATION_BYTES, MAX_EXCLUDE_PATHS_PER_ORIGIN,
    MAX_FORWARD_HEADERS_PER_ORIGIN, MAX_JWT_KEYS_PER_ORIGIN, MAX_JWT_ORIGINS, MAX_JWT_POLICY_BYTES,
    TokenSource,
};
