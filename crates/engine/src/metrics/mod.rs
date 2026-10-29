//! Aurora Gateway Internal Metrics Substrate
//!
//! # Architectural Model: Intrinsic Metrics Kernel <-> Pluggable Metrics Transport
//!
//! This module forms the foundational **Intrinsic Metrics Kernel (Lõi Metrics Nội Tại)**:
//! - `core_local`: Sub-nanosecond L1 cacheline live in-flight gauges & early rejection counters.
//! - `node`: Zero-allocation Linux kernel syscalls (`libc::sysinfo`) & `/proc/stat` CPU sampling.
//! - `collector`: Common in-memory raw metric values & counters.
//!
//! ## Decoupled Invariant:
//! The engine provides raw scalar counters and hardware-friendly atomics. It delegates all
//! wire protocols, scrapers, and transport mechanisms (Prometheus HTTP endpoints, OTLP Push,
//! StatsD UDP) to the plugin layer (`aurora_extensions`).
//!
//! - **Transport off $\implies$ Intrinsic off**: If no metrics transport plugin is enabled,
//!   the hot-path bypasses telemetry entirely (< 2ns), leaving the Intrinsic Kernel dormant.
//! - **Transport on $\implies$ Intrinsic on**: Only when a transport plugin registers interest
//!   will the Intrinsic Kernel update atomic counters. The transport then reads or formats
//!   these counters asynchronously without contending with traffic workers.
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
