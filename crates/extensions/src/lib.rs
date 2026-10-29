//! Aurora Gateway In-process Extensions.

pub use aurora_engine::{
    current_unix_nano,
    decision::{
        AccessDecision, AccessDenial, ConnectionToken, Decision, Error, MAX_PATH_BYTES,
        MAX_POLICY_BYTES, host_matches, host_specificity,
    },
    hardware, metrics,
    radix::{self, PathRadixTree},
    request::{AccessRequestContext, RequestContext},
};

pub mod redis_pool;

// Ingress & Access Phase Extensions
#[path = "blue-green/mod.rs"]
pub mod blue_green;
#[path = "canary-release/mod.rs"]
pub mod canary_release;
#[path = "compression-gzip/mod.rs"]
pub mod compression_gzip;
#[path = "connection-limit/mod.rs"]
pub mod connection_limit;
#[path = "correlation-id/mod.rs"]
pub mod correlation_id;
pub mod cors;
#[path = "ip-restriction/mod.rs"]
pub mod ip_restriction;
pub mod jwt;
pub mod maintenance;
#[path = "rate-limit/mod.rs"]
pub mod rate_limit;
#[path = "request-header-transform/mod.rs"]
pub mod request_header_transform;
#[path = "request-mirror/mod.rs"]
pub mod request_mirror;
#[path = "request-termination/mod.rs"]
pub mod request_termination;
#[path = "resource-limit/mod.rs"]
pub mod resource_limit;
#[path = "response-buffering/mod.rs"]
pub mod response_buffering;
#[path = "response-header-transform/mod.rs"]
pub mod response_header_transform;
#[path = "timeout-policy/mod.rs"]
pub mod timeout_policy;
#[path = "traffic-shaper/mod.rs"]
pub mod traffic_shaper;
#[path = "traffic-split/mod.rs"]
pub mod traffic_split;
#[path = "uri-rewrite/mod.rs"]
pub mod uri_rewrite;

// Egress & Background Phase Plugins (Exporters & Telemetry Plugins)
#[path = "std-log/mod.rs"]
pub mod std_log;
#[path = "opentelemetry/mod.rs"]
pub mod opentelemetry;
#[path = "prometheus/mod.rs"]
pub mod prometheus;

pub mod access;
pub mod background;
pub mod materialize;

// Top-level re-exports for clean ergonomics:
pub use access::{AccessPhaseEngines, AccessPhaseSpace};
pub use std_log::{
    AuroraLogInput, FastJsonLogTemplate, InlineStrBuffer, StdLogMetadata, StdLogPlugin, StdLogSlices,
    StdLogTask,
};
pub use background::{
    GatewayBackgroundTask, TELEMETRY_SUB_METRICS, TELEMETRY_SUB_STD_LOG, TELEMETRY_SUB_TRACING,
    clear_task_sender, dropped_tasks_count, has_metrics_subscriber, has_std_log_subscriber,
    has_telemetry_subscribers, increment_enqueued_tasks, logged_tasks_count,
    register_telemetry_subscriber, run_shadow_task_dispatcher, set_task_sender,
    set_telemetry_subscribers, submit_task, telemetry_subscribers, unregister_telemetry_subscriber,
};
pub use blue_green::BlueGreenEngine;
pub use canary_release::CanaryReleaseEngine;
pub use connection_limit::ConnectionLimitEngine;
pub use ip_restriction::IpRestrictionEngine;
pub use jwt::JwtEngine;
pub use opentelemetry::{PrecomputedOtlpSpanWriter, TraceSpanTask};
pub use prometheus::{
    HttpMetricTask, PrecomputedPrometheusEngine, PrometheusPlugin, WorkerHttpMetrics,
    get_prometheus_engine, get_worker_http_metrics, record_http_metrics,
};
pub use rate_limit::RateLimitEngine;
pub use request_mirror::RequestMirrorEngine;
pub use request_termination::RequestTerminationEngine;
pub use resource_limit::ResourceLimiter;
pub use traffic_shaper::TrafficShaperEngine;
pub use traffic_split::TrafficSplitEngine;
