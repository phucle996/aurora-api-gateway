//! Pre-computed OpenTelemetry (OTLP) Spans & Metrics Serialization.

pub mod writer;

#[cfg(test)]
mod tests;

pub use writer::{OtlpSpanRecord, PrecomputedOtlpSpanWriter, TraceSpanTask};
