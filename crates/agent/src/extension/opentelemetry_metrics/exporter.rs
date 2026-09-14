use super::config::{OtlpMetricsConfig, OtlpProtocol};
use crate::metrics::NodeMetrics;
use anyhow::{Context, Result, anyhow};
use opentelemetry_proto::tonic::collector::metrics::v1::{
    ExportMetricsServiceRequest, metrics_service_client::MetricsServiceClient,
};
use opentelemetry_proto::tonic::common::v1::{
    AnyValue, InstrumentationScope, KeyValue, any_value::Value as AnyValueUnion,
};
use opentelemetry_proto::tonic::metrics::v1::{
    AggregationTemporality, Gauge, Histogram, HistogramDataPoint, Metric, NumberDataPoint,
    ResourceMetrics, ScopeMetrics, Sum, metric::Data, number_data_point,
};
use opentelemetry_proto::tonic::resource::v1::Resource;
use prost::Message;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{debug, warn};

pub struct OtlpMetricsExporter {
    enabled: bool,
    endpoint: String,
    protocol: OtlpProtocol,
    interval: Duration,
    timeout: Duration,
    service_name: String,
    http_client: reqwest::Client,
}

impl OtlpMetricsExporter {
    pub fn new(config: OtlpMetricsConfig) -> Result<Self, String> {
        let protocol = OtlpProtocol::parse(&config.protocol)?;

        if config.enabled {
            if config.endpoint.trim().is_empty() {
                return Err("OTLP endpoint cannot be empty when enabled".to_string());
            }
            if !(1..=3600).contains(&config.interval_secs) {
                return Err(format!(
                    "OTLP interval_secs {} must be between 1 and 3600",
                    config.interval_secs
                ));
            }
            if !(100..=60000).contains(&config.timeout_ms) {
                return Err(format!(
                    "OTLP timeout_ms {} must be between 100 and 60000",
                    config.timeout_ms
                ));
            }
            if config.service_name.trim().is_empty() {
                return Err("OTLP service_name cannot be empty when enabled".to_string());
            }
        }

        let timeout = Duration::from_millis(config.timeout_ms.max(100));
        let http_client = reqwest::Client::builder()
            .timeout(timeout)
            .tcp_keepalive(Some(Duration::from_secs(60)))
            .build()
            .map_err(|e| format!("build reqwest client: {e}"))?;

        Ok(Self {
            enabled: config.enabled,
            endpoint: config.endpoint,
            protocol,
            interval: Duration::from_secs(config.interval_secs.max(1)),
            timeout,
            service_name: config.service_name,
            http_client,
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled && !self.endpoint.trim().is_empty()
    }

    pub fn protocol(&self) -> OtlpProtocol {
        self.protocol
    }

    pub fn interval(&self) -> Duration {
        self.interval
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    fn make_attr(key: &str, val: &str) -> KeyValue {
        KeyValue {
            key: key.to_string(),
            value: Some(AnyValue {
                value: Some(AnyValueUnion::StringValue(val.to_string())),
            }),
        }
    }

    pub fn build_metrics_request(
        &self,
        node_id: &str,
        metrics: &NodeMetrics,
        now_nanos: u64,
    ) -> ExportMetricsServiceRequest {
        let resource = Resource {
            attributes: vec![
                Self::make_attr("service.name", &self.service_name),
                Self::make_attr("host.id", node_id),
                Self::make_attr("telemetry.sdk.name", "aurora-waf"),
            ],
            ..Default::default()
        };

        let scope = InstrumentationScope {
            name: "aurora.gateway".to_string(),
            version: "0.1.0".to_string(),
            ..Default::default()
        };

        let explicit_bounds = vec![1.0, 5.0, 10.0, 50.0, 100.0, 500.0, 1000.0];
        // OpenTelemetry HistogramDataPoint requires discrete, non-cumulative counts for each bucket.
        // SHM maintains Prometheus-style cumulative buckets; convert by taking differences.
        let b1 = metrics.gateway.http_duration_bucket_1ms;
        let b5 = metrics.gateway.http_duration_bucket_5ms;
        let b10 = metrics.gateway.http_duration_bucket_10ms;
        let b50 = metrics.gateway.http_duration_bucket_50ms;
        let b100 = metrics.gateway.http_duration_bucket_100ms;
        let b500 = metrics.gateway.http_duration_bucket_500ms;
        let b1000 = metrics.gateway.http_duration_bucket_1000ms;
        let b_inf = metrics.gateway.http_duration_bucket_inf;

        let bucket_counts = vec![
            b1,
            b5.saturating_sub(b1),
            b10.saturating_sub(b5),
            b50.saturating_sub(b10),
            b100.saturating_sub(b50),
            b500.saturating_sub(b100),
            b1000.saturating_sub(b500),
            b_inf.saturating_sub(b1000),
        ];
        let hist_count: u64 = bucket_counts.iter().sum();

        let otel_metrics = vec![
            // 1. http_requests_total (Cumulative Sum)
            Metric {
                name: "http_requests_total".to_string(),
                description: "Total number of HTTP requests processed".to_string(),
                unit: "1".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Sum(Sum {
                    aggregation_temporality: AggregationTemporality::Cumulative as i32,
                    is_monotonic: true,
                    data_points: vec![NumberDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        value: Some(number_data_point::Value::AsInt(
                            metrics.requests_total as i64,
                        )),
                        exemplars: Vec::new(),
                        flags: 0,
                    }],
                })),
            },
            // 2. http_connections_active (Gauge)
            Metric {
                name: "http_connections_active".to_string(),
                description: "Number of active client connections".to_string(),
                unit: "1".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Gauge(Gauge {
                    data_points: vec![NumberDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        value: Some(number_data_point::Value::AsInt(
                            metrics.active_connections as i64,
                        )),
                        exemplars: Vec::new(),
                        flags: 0,
                    }],
                })),
            },
            // 3. gateway_waf_blocks_total (Cumulative Sum)
            Metric {
                name: "gateway_waf_blocks_total".to_string(),
                description: "Total number of requests blocked by WAF".to_string(),
                unit: "1".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Sum(Sum {
                    aggregation_temporality: AggregationTemporality::Cumulative as i32,
                    is_monotonic: true,
                    data_points: vec![NumberDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        value: Some(number_data_point::Value::AsInt(
                            metrics.gateway.waf_block as i64,
                        )),
                        exemplars: Vec::new(),
                        flags: 0,
                    }],
                })),
            },
            // 4. system_cpu_utilization_ratio (Gauge)
            Metric {
                name: "system_cpu_utilization_ratio".to_string(),
                description: "Current CPU utilization ratio (0.0 to 1.0)".to_string(),
                unit: "1".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Gauge(Gauge {
                    data_points: vec![NumberDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        value: Some(number_data_point::Value::AsDouble(metrics.cpu_utilization)),
                        exemplars: Vec::new(),
                        flags: 0,
                    }],
                })),
            },
            // 5. system_memory_used_bytes (Gauge)
            Metric {
                name: "system_memory_used_bytes".to_string(),
                description: "System memory used in bytes".to_string(),
                unit: "By".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Gauge(Gauge {
                    data_points: vec![NumberDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        value: Some(number_data_point::Value::AsInt(
                            metrics.memory_used_bytes as i64,
                        )),
                        exemplars: Vec::new(),
                        flags: 0,
                    }],
                })),
            },
            // 6. http_request_duration_ms (Histogram with 7 explicit bounds)
            Metric {
                name: "http_request_duration_ms".to_string(),
                description: "HTTP request latency in milliseconds".to_string(),
                unit: "ms".to_string(),
                metadata: Vec::new(),
                data: Some(Data::Histogram(Histogram {
                    aggregation_temporality: AggregationTemporality::Cumulative as i32,
                    data_points: vec![HistogramDataPoint {
                        attributes: Vec::new(),
                        start_time_unix_nano: 0,
                        time_unix_nano: now_nanos,
                        count: hist_count,
                        sum: Some(metrics.gateway.http_duration_sum_ms as f64),
                        bucket_counts,
                        explicit_bounds,
                        exemplars: Vec::new(),
                        flags: 0,
                        min: None,
                        max: None,
                    }],
                })),
            },
        ];

        ExportMetricsServiceRequest {
            resource_metrics: vec![ResourceMetrics {
                resource: Some(resource),
                scope_metrics: vec![ScopeMetrics {
                    scope: Some(scope),
                    metrics: otel_metrics,
                    schema_url: String::new(),
                }],
                schema_url: String::new(),
            }],
        }
    }

    pub async fn export_http(&self, request: &ExportMetricsServiceRequest) -> Result<()> {
        let url = if self.endpoint.ends_with("/v1/metrics") {
            self.endpoint.clone()
        } else {
            format!("{}/v1/metrics", self.endpoint.trim_end_matches('/'))
        };

        let body_bytes = request.encode_to_vec();

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/x-protobuf")
            .body(body_bytes)
            .send()
            .await
            .context("send OTLP HTTP metrics request")?;

        let status = response.status();
        if status.is_success() {
            debug!(status = %status, url = %url, "OTLP HTTP metrics exported successfully");
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(anyhow!(
                "OTLP Collector HTTP returned error {}: {}",
                status,
                body
            ))
        }
    }

    pub async fn export_grpc(&self, request: ExportMetricsServiceRequest) -> Result<()> {
        let is_https = self.endpoint.starts_with("https://");
        let endpoint_str =
            if self.endpoint.starts_with("http://") || self.endpoint.starts_with("https://") {
                self.endpoint.clone()
            } else {
                format!("http://{}", self.endpoint)
            };

        let mut tonic_endpoint = tonic::transport::Endpoint::from_shared(endpoint_str)
            .context("invalid OTLP gRPC endpoint URL")?
            .connect_timeout(self.timeout)
            .timeout(self.timeout);

        if is_https {
            let tls_config = tonic::transport::ClientTlsConfig::new().with_webpki_roots();
            tonic_endpoint = tonic_endpoint
                .tls_config(tls_config)
                .context("configure TLS for OTLP gRPC metrics endpoint")?;
        }

        let mut client =
            tokio::time::timeout(self.timeout, MetricsServiceClient::connect(tonic_endpoint))
                .await
                .context("connect timeout to OTLP gRPC collector")?
                .context("connect to OTLP gRPC collector")?;

        let grpc_req = tonic::Request::new(request);
        tokio::time::timeout(self.timeout, client.export(grpc_req))
            .await
            .context("export timeout for OTLP gRPC metrics")?
            .context("OTLP gRPC Export call failed")?;

        debug!(endpoint = %self.endpoint, "OTLP gRPC metrics exported successfully");
        Ok(())
    }

    pub async fn export(&self, node_id: &str, metrics: &NodeMetrics) -> Result<()> {
        if !self.is_enabled() {
            return Ok(());
        }

        let now_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);

        let request = self.build_metrics_request(node_id, metrics, now_nanos);

        match self.protocol {
            OtlpProtocol::Http => {
                if let Err(e) = self.export_http(&request).await {
                    warn!(endpoint = %self.endpoint, error = %e, "Failed to export metrics via OTLP HTTP");
                    return Err(e);
                }
            }
            OtlpProtocol::Grpc => {
                if let Err(e) = self.export_grpc(request).await {
                    warn!(endpoint = %self.endpoint, error = %e, "Failed to export metrics via OTLP gRPC");
                    return Err(e);
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_otlp_exporter_lifecycle() {
        let disabled = OtlpMetricsExporter::new(OtlpMetricsConfig {
            enabled: false,
            endpoint: "http://collector:4318".to_string(),
            protocol: "http".to_string(),
            interval_secs: 10,
            timeout_ms: 5000,
            service_name: "aurora".to_string(),
        })
        .unwrap();
        assert!(!disabled.is_enabled());

        assert!(
            OtlpMetricsExporter::new(OtlpMetricsConfig {
                enabled: true,
                endpoint: "".to_string(),
                protocol: "http".to_string(),
                interval_secs: 10,
                timeout_ms: 5000,
                service_name: "aurora".to_string(),
            })
            .is_err()
        );

        assert!(
            OtlpMetricsExporter::new(OtlpMetricsConfig {
                enabled: true,
                endpoint: "http://collector:4318".to_string(),
                protocol: "udp".to_string(),
                interval_secs: 10,
                timeout_ms: 5000,
                service_name: "aurora".to_string(),
            })
            .is_err()
        );

        assert!(
            OtlpMetricsExporter::new(OtlpMetricsConfig {
                enabled: true,
                endpoint: "http://collector:4318".to_string(),
                protocol: "http".to_string(),
                interval_secs: 0,
                timeout_ms: 5000,
                service_name: "aurora".to_string(),
            })
            .is_err()
        );

        assert!(
            OtlpMetricsExporter::new(OtlpMetricsConfig {
                enabled: true,
                endpoint: "http://collector:4318".to_string(),
                protocol: "http".to_string(),
                interval_secs: 10,
                timeout_ms: 50,
                service_name: "aurora".to_string(),
            })
            .is_err()
        );

        assert!(
            OtlpMetricsExporter::new(OtlpMetricsConfig {
                enabled: true,
                endpoint: "http://collector:4318".to_string(),
                protocol: "http".to_string(),
                interval_secs: 10,
                timeout_ms: 5000,
                service_name: "".to_string(),
            })
            .is_err()
        );

        let enabled_http = OtlpMetricsExporter::new(OtlpMetricsConfig {
            enabled: true,
            endpoint: "http://collector:4318".to_string(),
            protocol: "http".to_string(),
            interval_secs: 15,
            timeout_ms: 5000,
            service_name: "aurora".to_string(),
        })
        .unwrap();
        assert!(enabled_http.is_enabled());
        assert_eq!(enabled_http.protocol(), OtlpProtocol::Http);
        assert_eq!(enabled_http.interval(), Duration::from_secs(15));
    }

    #[test]
    fn test_build_metrics_request_structure() {
        let exporter = OtlpMetricsExporter::new(OtlpMetricsConfig {
            enabled: true,
            endpoint: "http://127.0.0.1:4318".to_string(),
            protocol: "http".to_string(),
            interval_secs: 15,
            timeout_ms: 5000,
            service_name: "test-gateway".to_string(),
        })
        .unwrap();
        let m = NodeMetrics {
            requests_total: 1000,
            active_connections: 42,
            gateway: aurora_engine::telemetry::GatewayMetricsSnapshot {
                http_requests_total: 1000,
                http_duration_sum_ms: 12500,
                http_duration_bucket_1ms: 100,
                http_duration_bucket_5ms: 350,
                http_duration_bucket_10ms: 600,
                http_duration_bucket_50ms: 850,
                http_duration_bucket_100ms: 950,
                http_duration_bucket_500ms: 990,
                http_duration_bucket_1000ms: 999,
                http_duration_bucket_inf: 1000,
                waf_block: 7,
                ..Default::default()
            },
            ..Default::default()
        };

        let req = exporter.build_metrics_request("node-alpha", &m, 1726300000000000000);
        assert_eq!(req.resource_metrics.len(), 1);

        let rm = &req.resource_metrics[0];
        let res = rm.resource.as_ref().unwrap();
        assert_eq!(res.attributes[0].key, "service.name");
        assert_eq!(
            res.attributes[0].value.as_ref().unwrap().value,
            Some(AnyValueUnion::StringValue("test-gateway".to_string()))
        );

        let sm = &rm.scope_metrics[0];
        assert_eq!(sm.metrics.len(), 6);

        let names: Vec<&str> = sm.metrics.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"http_requests_total"));
        assert!(names.contains(&"http_connections_active"));
        assert!(names.contains(&"gateway_waf_blocks_total"));
        assert!(names.contains(&"system_cpu_utilization_ratio"));
        assert!(names.contains(&"system_memory_used_bytes"));
        assert!(names.contains(&"http_request_duration_ms"));

        let duration_metric = sm
            .metrics
            .iter()
            .find(|m| m.name == "http_request_duration_ms")
            .unwrap();
        if let Some(Data::Histogram(ref h)) = duration_metric.data {
            let dp = &h.data_points[0];
            assert_eq!(dp.count, 1000);
            assert_eq!(dp.bucket_counts, vec![100, 250, 250, 250, 100, 40, 9, 1]);
            let sum_buckets: u64 = dp.bucket_counts.iter().sum();
            assert_eq!(sum_buckets, dp.count);
        } else {
            panic!("expected histogram data");
        }

        let proto_bytes = req.encode_to_vec();
        assert!(!proto_bytes.is_empty());
    }

    #[tokio::test]
    async fn test_otlp_metrics_grpc_connection_timeout_and_https() {
        // Test 1: Bounded connection timeout against non-routable IP (TEST-NET-1: 192.0.2.1)
        let exporter = OtlpMetricsExporter::new(OtlpMetricsConfig {
            enabled: true,
            endpoint: "http://192.0.2.1:4317".to_string(),
            protocol: "grpc".to_string(),
            interval_secs: 10,
            timeout_ms: 200,
            service_name: "test-metrics".to_string(),
        })
        .unwrap();

        let req = ExportMetricsServiceRequest::default();
        let start = std::time::Instant::now();
        let res = exporter.export_grpc(req.clone()).await;
        let elapsed = start.elapsed();

        assert!(res.is_err());
        // Verify it was bounded promptly by timeout (~200ms) and did not hang
        assert!(elapsed < Duration::from_millis(1500));

        // Test 2: HTTPS TLS configuration builds properly without error
        let https_exporter = OtlpMetricsExporter::new(OtlpMetricsConfig {
            enabled: true,
            endpoint: "https://127.0.0.1:4317".to_string(),
            protocol: "grpc".to_string(),
            interval_secs: 10,
            timeout_ms: 200,
            service_name: "test-metrics".to_string(),
        })
        .unwrap();
        let res_https = https_exporter.export_grpc(req).await;
        assert!(res_https.is_err());
    }
}
