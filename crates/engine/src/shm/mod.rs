//! Aurora Gateway Shared Memory (SHM) Substrate
//!
//! Subdivided into:
//! - `metrics`: High-performance lockless atomic counters & latency buckets.
//! - `logs`: Zero-overhead dynamic log consumer coordination & gating.

pub mod logs;
pub mod metrics;

pub use logs::*;
pub use metrics::*;

pub const TELEMETRY_MAGIC: u32 = 0x4155524F; // "AURO"
pub const TELEMETRY_VERSION: u32 = 2;
pub const SHM_DEFAULT_PATH: &str = "/dev/shm/aurora_gateway_telemetry.bin";
pub const SHM_SIZE_BYTES: usize = 4096;

/// Fixed latency bucket upper bounds in milliseconds:
/// <= 1ms, <= 5ms, <= 10ms, <= 50ms, <= 100ms, <= 500ms, <= 1000ms
pub const LATENCY_BUCKETS_MS: [u64; 7] = [1, 5, 10, 50, 100, 500, 1000];
