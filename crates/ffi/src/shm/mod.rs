//! Shared Memory Substrate (C ABI Layer)
//!
//! Exclusively powers multi-slot zero-copy policy hot-swapping via `policy`.
//! Telemetry and metrics are entirely in-process and do not utilize SHM.

pub mod policy;

pub use policy::*;
