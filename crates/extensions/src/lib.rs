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
#[path = "ip-restriction/mod.rs"]
pub mod ip_restriction;
pub use ip_restriction as ip_restriction_ext;
#[path = "blue-green/mod.rs"]
pub mod blue_green;
#[path = "canary-release/mod.rs"]
pub mod canary_release;
#[path = "connection-limit/mod.rs"]
pub mod connection_limit;
pub mod jwt;
#[path = "rate-limit/mod.rs"]
pub mod rate_limit;
#[path = "request-mirror/mod.rs"]
pub mod request_mirror;
#[path = "request-size-limit/mod.rs"]
pub mod request_size_limit;
#[path = "request-termination/mod.rs"]
pub mod request_termination;
#[path = "traffic-shaper/mod.rs"]
pub mod traffic_shaper;
#[path = "traffic-split/mod.rs"]
pub mod traffic_split;

// Egress & Background Phase Plugins (Exporters & Telemetry Plugins)
#[path = "access-log/mod.rs"]
pub mod access_log;
#[path = "opentelemetry/mod.rs"]
pub mod opentelemetry;
#[path = "prometheus/mod.rs"]
pub mod prometheus;

pub mod access;
pub mod background;

// Top-level re-exports for clean ergonomics:
pub use access::{AccessPhaseEngines, AccessPhaseSpace};
pub use access_log::{AccessLogMetadata, AccessLogPlugin, AccessLogSlices, AccessLogTask};
pub use background::{
    GatewayBackgroundTask, clear_task_sender, dropped_tasks_count, logged_tasks_count,
    run_shadow_task_dispatcher, set_task_sender, submit_task,
};
pub use blue_green::BlueGreenEngine;
pub use canary_release::CanaryReleaseEngine;
pub use connection_limit::ConnectionLimitEngine;
pub use ip_restriction::IpRestrictionEngine;
pub use jwt::JwtEngine;
pub use opentelemetry::{PrecomputedOtlpSpanWriter, TraceSpanTask};
pub use prometheus::{
    HttpMetricTask, PrecomputedPrometheusEngine, PrometheusPlugin, get_prometheus_engine,
};
pub use rate_limit::RateLimitEngine;
pub use request_mirror::RequestMirrorEngine;
pub use request_size_limit::RequestSizeLimitEngine;
pub use request_termination::RequestTerminationEngine;
pub use traffic_shaper::TrafficShaperEngine;
pub use traffic_split::TrafficSplitEngine;
