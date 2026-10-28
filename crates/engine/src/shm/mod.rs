//! Aurora Gateway Shared Memory (SHM) Substrate
//!
//! Exclusively powers multi-slot zero-copy policy hot-swapping via `policy.rs`.
//! Telemetry and metrics are entirely in-process and do not utilize SHM.

pub mod policy;

pub use policy::*;
