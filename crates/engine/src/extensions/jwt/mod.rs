//! In-process JWT authorization for the NGINX access phase.
//!
//! Features:
//! - Origin-First Scoping: Each Origin (Domain/Host) represents an Upstream Backend.
//! - Default-Deny with `exclude_paths` bypass whitelist.
//! - Multi-Algorithm: Symmetric (HS256/384/512) and Asymmetric (RS256/384/512, ES256/384, EdDSA).
//! - Zero-downtime Key Rotation via Key Ring with O(1) `kid` lookup.
//! - Claims Forwarding 3-column mapping: payload_key | header_key | value pattern (regex).

mod crypto;
mod engine;
mod types;

#[cfg(test)]
mod tests;

pub use engine::JwtEngine;
pub use types::{
    ForwardedHeader, JwtDecision, MAX_AUTHORIZATION_BYTES, MAX_EXCLUDE_PATHS_PER_ORIGIN,
    MAX_FORWARD_HEADERS_PER_ORIGIN, MAX_JWT_KEYS_PER_ORIGIN, MAX_JWT_ORIGINS, MAX_JWT_POLICY_BYTES,
};
