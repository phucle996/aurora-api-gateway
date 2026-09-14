use super::opentelemetry_logs::{
    OtlpLogsConfig, OtlpLogsExporter, OtlpLogsWorkerHandle, spawn_otlp_logs_worker,
};
use super::opentelemetry_metrics::{
    OtlpMetricsConfig, OtlpMetricsExporter, spawn_otlp_metrics_worker,
};
use super::prometheus::spawn_prometheus_server;
use super::std_log::{
    StdLogConfig, StdLogFormat, StdLogLevel, StdLogWorkerHandle, spawn_std_log_worker,
};
use crate::logs::LogBus;
use crate::metrics::MetricsCollector;
use crate::spec::extensions::{
    ExtensionInstanceSpec, MetricsExtensionSpec, OpenTelemetryLogsSpec, OpenTelemetryMetricsSpec,
    StdLogSpec,
};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use tracing::info;

/// Owns extension processes that run outside NGINX. NGINX extensions are
/// materialized from the same instance envelopes before this dispatcher runs.
pub struct ExtensionDispatcher {
    node_id: Arc<String>,
    log_bus: Option<Arc<LogBus>>,
    metrics_collector: Arc<MetricsCollector>,

    // Prometheus extension lifecycle
    pub(crate) prometheus_shutdown: Option<CancellationToken>,
    last_prometheus_port: Option<u16>,

    // OpenTelemetry metrics extension lifecycle
    pub(crate) otel_metrics_shutdown: Option<CancellationToken>,
    last_otel_metrics_config: Option<OtlpMetricsConfig>,

    // OpenTelemetry logs extension lifecycle
    pub(crate) logs_worker: Option<OtlpLogsWorkerHandle>,
    last_otel_logs_spec: Option<OpenTelemetryLogsSpec>,

    // Standard stream logs (stdout/stderr) extension lifecycle
    pub(crate) std_log_worker: Option<StdLogWorkerHandle>,
    last_std_log_spec: Option<StdLogSpec>,
}

impl ExtensionDispatcher {
    pub fn new(node_id: Arc<String>, log_bus: Option<Arc<LogBus>>) -> Self {
        Self {
            node_id,
            log_bus,
            metrics_collector: Arc::new(MetricsCollector::new()),
            prometheus_shutdown: None,
            last_prometheus_port: None,
            otel_metrics_shutdown: None,
            last_otel_metrics_config: None,
            logs_worker: None,
            last_otel_logs_spec: None,
            std_log_worker: None,
            last_std_log_spec: None,
        }
    }

    pub async fn apply_spec(&mut self, instances: &[ExtensionInstanceSpec]) -> Result<(), String> {
        let mut metrics = None;
        let mut otel = None;
        let mut otel_logs = None;
        let mut std_log = None;

        for instance in instances {
            match instance.renderer.as_str() {
                "agent-metrics" => {
                    if metrics.is_some() {
                        return Err(
                            "NodeSpec contains more than one agent-metrics extension".to_string()
                        );
                    }
                    metrics = Some(
                        serde_json::from_str::<MetricsExtensionSpec>(&instance.config_json)
                            .map_err(|error| {
                                format!(
                                    "decode metrics extension instance {} config: {error}",
                                    instance.instance_id
                                )
                            })?,
                    );
                }
                "opentelemetry-metrics" => {
                    if otel.is_some() {
                        return Err(
                            "NodeSpec contains more than one opentelemetry-metrics extension"
                                .to_string(),
                        );
                    }
                    let spec = serde_json::from_str::<OpenTelemetryMetricsSpec>(
                        &instance.config_json,
                    )
                    .map_err(|error| {
                        format!(
                            "decode opentelemetry-metrics extension instance {} config: {error}",
                            instance.instance_id
                        )
                    })?;
                    if spec.endpoint.trim().is_empty() {
                        return Err(format!(
                            "opentelemetry-metrics extension instance {} endpoint cannot be empty",
                            instance.instance_id
                        ));
                    }
                    if spec.protocol != "http" && spec.protocol != "grpc" {
                        return Err(format!(
                            "opentelemetry-metrics extension instance {} unsupported protocol: {}",
                            instance.instance_id, spec.protocol
                        ));
                    }
                    if spec.service_name.trim().is_empty() {
                        return Err(format!(
                            "opentelemetry-metrics extension instance {} service_name cannot be empty",
                            instance.instance_id
                        ));
                    }
                    otel = Some(spec);
                }
                "opentelemetry-logs" => {
                    if otel_logs.is_some() {
                        return Err(
                            "NodeSpec contains more than one opentelemetry-logs extension"
                                .to_string(),
                        );
                    }
                    let spec = serde_json::from_str::<OpenTelemetryLogsSpec>(&instance.config_json)
                        .map_err(|error| {
                            format!(
                                "decode opentelemetry-logs extension instance {} config: {error}",
                                instance.instance_id
                            )
                        })?;
                    if spec.endpoint.trim().is_empty() {
                        return Err(format!(
                            "opentelemetry-logs extension instance {} endpoint cannot be empty",
                            instance.instance_id
                        ));
                    }
                    if spec.protocol != "http" && spec.protocol != "grpc" {
                        return Err(format!(
                            "opentelemetry-logs extension instance {} unsupported protocol: {}",
                            instance.instance_id, spec.protocol
                        ));
                    }
                    if spec.service_name.trim().is_empty() {
                        return Err(format!(
                            "opentelemetry-logs extension instance {} service_name cannot be empty",
                            instance.instance_id
                        ));
                    }
                    otel_logs = Some(spec);
                }
                "std-log" | "stdout-logs" | "stdout-stderr-logs" => {
                    if std_log.is_some() {
                        return Err("NodeSpec contains more than one std-log extension".to_string());
                    }
                    let spec = serde_json::from_str::<StdLogSpec>(&instance.config_json).map_err(
                        |error| {
                            format!(
                                "decode std-log extension instance {} config: {error}",
                                instance.instance_id
                            )
                        },
                    )?;
                    if !matches!(
                        spec.format.to_ascii_lowercase().as_str(),
                        "json" | "text" | "combined"
                    ) {
                        return Err(format!(
                            "std-log extension instance {} unsupported format: {}",
                            instance.instance_id, spec.format
                        ));
                    }
                    if !matches!(
                        spec.log_level.to_ascii_lowercase().as_str(),
                        "info" | "warn" | "error" | "all"
                    ) {
                        return Err(format!(
                            "std-log extension instance {} unsupported log_level: {}",
                            instance.instance_id, spec.log_level
                        ));
                    }
                    std_log = Some(spec);
                }
                _ => {}
            }
        }

        // Dispatch Prometheus scrape server independently
        let prom_active = metrics
            .as_ref()
            .and_then(|m| m.prometheus.as_ref())
            .is_some_and(|p| p.enabled);
        let prom_port = metrics.as_ref().map_or(9145, |m| m.port);
        self.dispatch_prometheus(prom_active, prom_port).await;

        // Dispatch OpenTelemetry metrics background exporter independently
        let otel_metrics_cfg = if let Some(spec) = otel {
            Some(OtlpMetricsConfig {
                enabled: spec.enabled,
                endpoint: spec.endpoint,
                protocol: spec.protocol,
                interval_secs: spec.interval_secs,
                timeout_ms: spec.timeout_ms,
                service_name: spec.service_name,
            })
        } else {
            metrics
                .as_ref()
                .and_then(|m| m.otlp.as_ref())
                .map(|otlp| OtlpMetricsConfig {
                    enabled: otlp.enabled,
                    endpoint: otlp.endpoint.clone(),
                    protocol: otlp.protocol.clone(),
                    interval_secs: otlp.interval_secs,
                    timeout_ms: otlp.timeout_ms,
                    service_name: otlp.service_name.clone(),
                })
        };
        self.dispatch_opentelemetry_metrics(otel_metrics_cfg).await;

        // Dispatch OpenTelemetry logs background exporter independently
        self.dispatch_logs(otel_logs.as_ref()).await;

        // Dispatch Standard stream logs (stdout/stderr) independently
        self.dispatch_std_log(std_log.as_ref()).await;

        Ok(())
    }

    async fn dispatch_prometheus(&mut self, enabled: bool, port: u16) {
        if !enabled {
            if let Some(cancel) = self.prometheus_shutdown.take() {
                info!("Stopping Prometheus metrics extension");
                cancel.cancel();
            }
            self.last_prometheus_port = None;
            return;
        }

        if self.prometheus_shutdown.is_some() && self.last_prometheus_port == Some(port) {
            return;
        }

        if let Some(cancel) = self.prometheus_shutdown.take() {
            info!("Reloading Prometheus metrics server with updated port");
            cancel.cancel();
        }

        let cancel = spawn_prometheus_server(
            port,
            Arc::clone(&self.node_id),
            Arc::clone(&self.metrics_collector),
        );
        self.prometheus_shutdown = Some(cancel);
        self.last_prometheus_port = Some(port);
        info!(port, "Prometheus metrics server started");
    }

    async fn dispatch_opentelemetry_metrics(&mut self, config_opt: Option<OtlpMetricsConfig>) {
        let is_active = config_opt
            .as_ref()
            .is_some_and(|c| c.enabled && !c.endpoint.trim().is_empty());

        if !is_active {
            if let Some(cancel) = self.otel_metrics_shutdown.take() {
                info!("Stopping OpenTelemetry metrics exporter");
                cancel.cancel();
            }
            self.last_otel_metrics_config = None;
            return;
        }

        if self.otel_metrics_shutdown.is_some() && self.last_otel_metrics_config == config_opt {
            return;
        }

        if let Some(cancel) = self.otel_metrics_shutdown.take() {
            info!("Reloading metrics extension(s) with updated configuration");
            cancel.cancel();
        }

        let config = config_opt.unwrap();
        match OtlpMetricsExporter::new(config.clone()) {
            Ok(exporter) => {
                let cancel = spawn_otlp_metrics_worker(
                    Arc::clone(&self.node_id),
                    Arc::new(exporter),
                    Arc::clone(&self.metrics_collector),
                );
                self.otel_metrics_shutdown = Some(cancel);
                self.last_otel_metrics_config = Some(config);
            }
            Err(err) => {
                tracing::error!("Failed to initialize OpenTelemetry metrics exporter: {err}");
                self.last_otel_metrics_config = None;
            }
        }
    }

    async fn dispatch_logs(&mut self, otel_logs_spec: Option<&OpenTelemetryLogsSpec>) {
        let is_active = otel_logs_spec
            .filter(|o| o.enabled && !o.endpoint.trim().is_empty())
            .is_some();

        if !is_active {
            if let Some(mut worker) = self.logs_worker.take() {
                info!("Stopping OpenTelemetry logs extension");
                worker.shutdown(std::time::Duration::from_secs(3)).await;
            }
            self.last_otel_logs_spec = None;
            return;
        }

        if self.logs_worker.is_some() && self.last_otel_logs_spec.as_ref() == otel_logs_spec {
            return;
        }

        if let Some(mut worker) = self.logs_worker.take() {
            info!("Reloading OpenTelemetry logs extension with updated configuration");
            worker.shutdown(std::time::Duration::from_secs(3)).await;
        }

        let spec = otel_logs_spec.unwrap();
        let logs_config = OtlpLogsConfig {
            enabled: spec.enabled,
            endpoint: spec.endpoint.clone(),
            protocol: spec.protocol.clone(),
            batch_size: spec.batch_size,
            flush_interval_ms: spec.flush_interval_ms,
            timeout_ms: spec.timeout_ms,
            service_name: spec.service_name.clone(),
            log_level: spec.log_level.clone(),
        };
        match OtlpLogsExporter::new(logs_config) {
            Ok(exporter) => {
                let node_id = (*self.node_id).clone();
                let subscription = self
                    .log_bus
                    .as_ref()
                    .map(|b| b.subscribe("opentelemetry-logs"));
                let handle = spawn_otlp_logs_worker(node_id, exporter, subscription);
                self.logs_worker = Some(handle);
                info!(
                    endpoint = %spec.endpoint,
                    protocol = %spec.protocol,
                    batch_size = spec.batch_size,
                    "Spawned OpenTelemetry logs background exporter"
                );
            }
            Err(err) => {
                tracing::error!("Failed to initialize OpenTelemetry logs exporter: {err}");
            }
        }
        self.last_otel_logs_spec = otel_logs_spec.cloned();
    }

    async fn dispatch_std_log(&mut self, std_log_spec: Option<&StdLogSpec>) {
        let is_active = std_log_spec.filter(|s| s.enabled).is_some();

        if !is_active {
            if let Some(mut worker) = self.std_log_worker.take() {
                info!("Stopping standard stream logs extension");
                worker.shutdown(std::time::Duration::from_secs(3)).await;
            }
            self.last_std_log_spec = None;
            return;
        }

        if self.std_log_worker.is_some() && self.last_std_log_spec.as_ref() == std_log_spec {
            return;
        }

        if let Some(mut worker) = self.std_log_worker.take() {
            info!("Reloading standard stream logs extension with updated configuration");
            worker.shutdown(std::time::Duration::from_secs(3)).await;
        }

        let spec = std_log_spec.unwrap();
        let format = match StdLogFormat::parse(&spec.format) {
            Ok(f) => f,
            Err(e) => {
                tracing::error!("Failed to parse std-log format: {e}");
                return;
            }
        };
        let log_level = match StdLogLevel::parse(&spec.log_level) {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("Failed to parse std-log log_level: {e}");
                return;
            }
        };

        let config = StdLogConfig {
            enabled: spec.enabled,
            format,
            split_streams: spec.split_streams,
            log_level,
            include_waf_details: spec.include_waf_details,
        };

        let subscription = self.log_bus.as_ref().map(|b| b.subscribe("std-log"));
        let handle = spawn_std_log_worker(config, subscription);
        self.std_log_worker = Some(handle);
        info!(
            format = %spec.format,
            split_streams = spec.split_streams,
            log_level = %spec.log_level,
            "Spawned standard stream logs background worker"
        );
        self.last_std_log_spec = std_log_spec.cloned();
    }

    pub async fn shutdown_all(&mut self) {
        if let Some(cancel) = self.prometheus_shutdown.take() {
            cancel.cancel();
        }
        if let Some(cancel) = self.otel_metrics_shutdown.take() {
            cancel.cancel();
        }
        if let Some(mut worker) = self.logs_worker.take() {
            worker.shutdown(std::time::Duration::from_secs(3)).await;
        }
        if let Some(mut worker) = self.std_log_worker.take() {
            worker.shutdown(std::time::Duration::from_secs(3)).await;
        }
        self.last_prometheus_port = None;
        self.last_otel_metrics_config = None;
        self.last_otel_logs_spec = None;
        self.last_std_log_spec = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::extensions::ExtensionInstanceSpec;

    #[tokio::test]
    async fn dispatcher_starts_and_stops_metrics_from_manifest_instance() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "prometheus".to_string(),
            key: "builtin/prometheus".to_string(),
            version: 1,
            renderer: "agent-metrics".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"port":19145,"prometheus":{"enabled":true,"path":"/metrics"}}"#
                .to_string(),
        }];
        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.prometheus_shutdown.is_some());
        assert!(dispatcher.otel_metrics_shutdown.is_none());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.prometheus_shutdown.is_none());
        assert!(dispatcher.otel_metrics_shutdown.is_none());
    }

    #[tokio::test]
    async fn dispatcher_starts_and_stops_opentelemetry_instance() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "opentelemetry-metrics".to_string(),
            key: "builtin/opentelemetry-metrics".to_string(),
            version: 1,
            renderer: "opentelemetry-metrics".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":10,"timeout_ms":3000,"service_name":"aurora-waf"}"#
                .to_string(),
        }];
        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.otel_metrics_shutdown.is_some());
        assert!(dispatcher.prometheus_shutdown.is_none());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.otel_metrics_shutdown.is_none());
        assert!(dispatcher.prometheus_shutdown.is_none());
    }

    #[tokio::test]
    async fn dispatcher_handles_both_prometheus_and_opentelemetry_independently() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "prometheus".to_string(),
                key: "builtin/prometheus".to_string(),
                version: 1,
                renderer: "agent-metrics".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"port":19146,"prometheus":{"enabled":true,"path":"/metrics"}}"#
                    .to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "opentelemetry-metrics".to_string(),
                key: "builtin/opentelemetry-metrics".to_string(),
                version: 1,
                renderer: "opentelemetry-metrics".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":10,"timeout_ms":3000,"service_name":"aurora-waf"}"#
                    .to_string(),
            },
        ];
        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.prometheus_shutdown.is_some());
        assert!(dispatcher.otel_metrics_shutdown.is_some());

        // Stopping opentelemetry-metrics should NOT stop prometheus
        let prom_token = dispatcher.prometheus_shutdown.clone().unwrap();
        let prom_only = vec![instances[0].clone()];
        dispatcher.apply_spec(&prom_only).await.unwrap();
        assert!(dispatcher.prometheus_shutdown.is_some());
        assert!(dispatcher.otel_metrics_shutdown.is_none());
        // Prometheus server was untouched (token unchanged)
        assert!(!prom_token.is_cancelled());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.prometheus_shutdown.is_none());
        assert!(dispatcher.otel_metrics_shutdown.is_none());
    }

    #[tokio::test]
    async fn dispatcher_errors_on_duplicate_opentelemetry() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "otel-1".to_string(),
                key: "builtin/opentelemetry-metrics".to_string(),
                version: 1,
                renderer: "opentelemetry-metrics".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":10,"timeout_ms":3000,"service_name":"aurora-waf"}"#.to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "otel-2".to_string(),
                key: "builtin/opentelemetry-metrics".to_string(),
                version: 1,
                renderer: "opentelemetry-metrics".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":10,"timeout_ms":3000,"service_name":"aurora-waf"}"#.to_string(),
            },
        ];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(err.contains("NodeSpec contains more than one opentelemetry-metrics extension"));
    }

    #[tokio::test]
    async fn dispatcher_rejects_missing_field_in_opentelemetry() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "otel-missing".to_string(),
            key: "builtin/opentelemetry-metrics".to_string(),
            version: 1,
            renderer: "opentelemetry-metrics".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":10}"#.to_string(),
        }];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(
            err.contains("decode opentelemetry-metrics extension instance otel-missing config")
        );
    }

    #[tokio::test]
    async fn dispatcher_starts_and_stops_opentelemetry_logs_instance() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "opentelemetry-logs".to_string(),
            key: "builtin/opentelemetry-logs".to_string(),
            version: 1,
            renderer: "opentelemetry-logs".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-waf","log_level":"info"}"#.to_string(),
        }];
        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.logs_worker.is_some());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.logs_worker.is_none());
    }

    #[tokio::test]
    async fn dispatcher_errors_on_duplicate_opentelemetry_logs() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "logs-1".to_string(),
                key: "builtin/opentelemetry-logs".to_string(),
                version: 1,
                renderer: "opentelemetry-logs".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-waf","log_level":"info"}"#.to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "logs-2".to_string(),
                key: "builtin/opentelemetry-logs".to_string(),
                version: 1,
                renderer: "opentelemetry-logs".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-waf","log_level":"info"}"#.to_string(),
            },
        ];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(err.contains("NodeSpec contains more than one opentelemetry-logs extension"));
    }

    #[tokio::test]
    async fn dispatcher_rejects_missing_field_in_opentelemetry_logs() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "logs-missing".to_string(),
            key: "builtin/opentelemetry-logs".to_string(),
            version: 1,
            renderer: "opentelemetry-logs".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-waf"}"#.to_string(),
        }];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(err.contains("decode opentelemetry-logs extension instance logs-missing config"));
    }

    #[tokio::test]
    async fn dispatcher_starts_and_stops_std_log_instance() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "std-log-inst".to_string(),
            key: "builtin/std-log".to_string(),
            version: 1,
            renderer: "std-log".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}"#.to_string(),
        }];

        dispatcher.apply_spec(&instances).await.unwrap();
        assert!(dispatcher.std_log_worker.is_some());

        dispatcher.apply_spec(&[]).await.unwrap();
        assert!(dispatcher.std_log_worker.is_none());
    }

    #[tokio::test]
    async fn dispatcher_errors_on_duplicate_std_log() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![
            ExtensionInstanceSpec {
                instance_id: "std-log-1".to_string(),
                key: "builtin/std-log".to_string(),
                version: 1,
                renderer: "std-log".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}"#.to_string(),
            },
            ExtensionInstanceSpec {
                instance_id: "std-log-2".to_string(),
                key: "builtin/std-log".to_string(),
                version: 1,
                renderer: "std-log".to_string(),
                manifest_digest: String::new(),
                config_json: r#"{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}"#.to_string(),
            },
        ];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(err.contains("NodeSpec contains more than one std-log extension"));
    }

    #[tokio::test]
    async fn dispatcher_rejects_invalid_format_in_std_log() {
        let mut dispatcher = ExtensionDispatcher::new(Arc::new("node-01".to_string()), None);
        let instances = vec![ExtensionInstanceSpec {
            instance_id: "std-log-bad-fmt".to_string(),
            key: "builtin/std-log".to_string(),
            version: 1,
            renderer: "std-log".to_string(),
            manifest_digest: String::new(),
            config_json: r#"{"enabled":true,"format":"binary","split_streams":true,"log_level":"info","include_waf_details":true}"#.to_string(),
        }];
        let err = dispatcher.apply_spec(&instances).await.unwrap_err();
        assert!(err.contains("unsupported format: binary"));
    }
}
