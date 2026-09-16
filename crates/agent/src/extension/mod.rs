pub mod dispatcher;
pub mod opentelemetry_logs;
pub mod opentelemetry_metrics;
pub mod opentelemetry_tracing;
pub mod prometheus;
pub mod std_log;

pub use dispatcher::ExtensionDispatcher;
