//! Standard Stream & Structured Log Plugin Subsystem (`builtin/std-log`).

pub mod plugin;
pub mod task;
pub mod template;

pub use plugin::StdLogPlugin;
pub use task::{AuroraLogInput, InlineStrBuffer, StdLogMetadata, StdLogSlices, StdLogTask};
pub use template::{FastJsonLogTemplate, write_escaped_bytes, write_escaped_str, write_u64};

#[cfg(test)]
mod tests;
