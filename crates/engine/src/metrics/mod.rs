//! Aurora Gateway Internal Metrics Substrate
//!
//! Subdivided into:
//! - `core_local`: Sub-nanosecond L1 cacheline live in-flight gauges & early rejection counters.
//! - `node`: Zero-allocation Linux kernel syscalls (`libc::sysinfo`) & `/proc/stat` CPU sampling.
//! - `collector`: Common in-memory raw metric values & counters.

pub mod collector;
pub mod core_local;
pub mod node;

pub use collector::*;
pub use core_local::*;
pub use node::*;
