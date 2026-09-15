use super::config::{LogLevelFilter, OtlpLogsConfig, OtlpProtocol};
use anyhow::{Context, Result, anyhow};
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsServiceRequest, logs_service_client::LogsServiceClient,
};
use opentelemetry_proto::tonic::common::v1::{
    AnyValue, InstrumentationScope, KeyValue, any_value::Value as AnyValueUnion,
};
use opentelemetry_proto::tonic::logs::v1::{LogRecord, ResourceLogs, ScopeLogs};
use opentelemetry_proto::tonic::resource::v1::Resource;
use prost::Message;
use std::time::Duration;
use tracing::debug;

#[derive(Clone)]
pub struct OtlpLogsExporter {
    enabled: bool,
    endpoint: String,
    protocol: OtlpProtocol,
    batch_size: usize,
    flush_interval: Duration,
    timeout: Duration,
    service_name: String,
    log_level: LogLevelFilter,
    http_client: reqwest::Client,
}

impl OtlpLogsExporter {
    pub fn new(config: OtlpLogsConfig) -> Result<Self, String> {
        let protocol = OtlpProtocol::parse(&config.protocol)?;
        let log_level = LogLevelFilter::parse(&config.log_level)?;

        if config.enabled {
            if config.endpoint.trim().is_empty() {
                return Err("OTLP logs endpoint cannot be empty when enabled".to_string());
            }
            if !(1..=5000).contains(&config.batch_size) {
                return Err(format!(
                    "OTLP logs batch_size {} must be between 1 and 5000",
                    config.batch_size
                ));
            }
            if !(100..=60000).contains(&config.flush_interval_ms) {
                return Err(format!(
                    "OTLP logs flush_interval_ms {} must be between 100 and 60000",
                    config.flush_interval_ms
                ));
            }
            if !(100..=60000).contains(&config.timeout_ms) {
                return Err(format!(
                    "OTLP logs timeout_ms {} must be between 100 and 60000",
                    config.timeout_ms
                ));
            }
            if config.service_name.trim().is_empty() {
                return Err("OTLP logs service_name cannot be empty when enabled".to_string());
            }
        }

        let timeout = Duration::from_millis(config.timeout_ms.max(100));
        let http_client = reqwest::Client::builder()
            .timeout(timeout)
            .tcp_keepalive(Some(Duration::from_secs(60)))
            .build()
            .map_err(|e| format!("build reqwest client for logs: {e}"))?;

        Ok(Self {
            enabled: config.enabled,
            endpoint: config.endpoint,
            protocol,
            batch_size: config.batch_size.max(1),
            flush_interval: Duration::from_millis(config.flush_interval_ms.max(100)),
            timeout,
            service_name: config.service_name,
            log_level,
            http_client,
        })
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn protocol(&self) -> OtlpProtocol {
        self.protocol
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    pub fn batch_size(&self) -> usize {
        self.batch_size
    }

    pub fn flush_interval(&self) -> Duration {
        self.flush_interval
    }

    pub fn log_level(&self) -> LogLevelFilter {
        self.log_level
    }

    pub fn build_logs_request(
        &self,
        node_id: &str,
        records: Vec<LogRecord>,
    ) -> ExportLogsServiceRequest {
        let resource = Resource {
            attributes: vec![
                KeyValue {
                    key: "service.name".to_string(),
                    value: Some(AnyValue {
                        value: Some(AnyValueUnion::StringValue(self.service_name.clone())),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "host.id".to_string(),
                    value: Some(AnyValue {
                        value: Some(AnyValueUnion::StringValue(node_id.to_string())),
                    }),
                    ..Default::default()
                },
                KeyValue {
                    key: "telemetry.sdk.name".to_string(),
                    value: Some(AnyValue {
                        value: Some(AnyValueUnion::StringValue("aurora-waf".to_string())),
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let scope = InstrumentationScope {
            name: "aurora.gateway.logs".to_string(),
            version: "0.1.0".to_string(),
            ..Default::default()
        };

        ExportLogsServiceRequest {
            resource_logs: vec![ResourceLogs {
                resource: Some(resource),
                scope_logs: vec![ScopeLogs {
                    scope: Some(scope),
                    log_records: records,
                    schema_url: String::new(),
                }],
                schema_url: String::new(),
            }],
        }
    }

    pub async fn export_batch(&self, node_id: &str, records: Vec<LogRecord>) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        let count = records.len();
        let request = self.build_logs_request(node_id, records);

        match self.protocol {
            OtlpProtocol::Http => self.export_http(&request).await?,
            OtlpProtocol::Grpc => self.export_grpc(request).await?,
        }

        debug!(count = count, protocol = ?self.protocol, "OTLP logs batch exported successfully");
        Ok(())
    }

    async fn export_http(&self, request: &ExportLogsServiceRequest) -> Result<()> {
        let url = if self.endpoint.ends_with("/v1/logs") {
            self.endpoint.clone()
        } else {
            format!("{}/v1/logs", self.endpoint.trim_end_matches('/'))
        };

        let body_bytes = request.encode_to_vec();

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/x-protobuf")
            .body(body_bytes)
            .send()
            .await
            .context("send OTLP HTTP logs request")?;

        let status = response.status();
        if status.is_success() {
            debug!(status = %status, url = %url, "OTLP HTTP logs exported successfully");
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(anyhow!(
                "OTLP Collector HTTP logs returned error {}: {}",
                status,
                body
            ))
        }
    }

    async fn export_grpc(&self, request: ExportLogsServiceRequest) -> Result<()> {
        let is_https = self.endpoint.starts_with("https://");
        let endpoint_str =
            if self.endpoint.starts_with("http://") || self.endpoint.starts_with("https://") {
                self.endpoint.clone()
            } else {
                format!("http://{}", self.endpoint)
            };

        let mut tonic_endpoint = tonic::transport::Endpoint::from_shared(endpoint_str)
            .context("invalid OTLP gRPC logs endpoint URL")?
            .connect_timeout(self.timeout)
            .timeout(self.timeout);

        if is_https {
            let tls_config = tonic::transport::ClientTlsConfig::new().with_webpki_roots();
            tonic_endpoint = tonic_endpoint
                .tls_config(tls_config)
                .context("configure TLS for OTLP gRPC logs endpoint")?;
        }

        let mut client =
            tokio::time::timeout(self.timeout, LogsServiceClient::connect(tonic_endpoint))
                .await
                .context("connect timeout to OTLP gRPC collector for logs")?
                .context("connect to OTLP gRPC collector for logs")?;

        let grpc_req = tonic::Request::new(request);
        tokio::time::timeout(self.timeout, client.export(grpc_req))
            .await
            .context("export timeout for OTLP gRPC logs")?
            .context("OTLP gRPC ExportLogs call failed")?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl Default for OtlpLogsConfig {
        fn default() -> Self {
            Self {
                enabled: true,
                endpoint: "http://collector:4318".to_string(),
                protocol: "http".to_string(),
                batch_size: 100,
                flush_interval_ms: 2000,
                timeout_ms: 5000,
                service_name: "aurora".to_string(),
                log_level: "info".to_string(),
            }
        }
    }

    #[test]
    fn test_otlp_logs_exporter_validation() {
        assert!(OtlpLogsExporter::new(OtlpLogsConfig::default()).is_ok());

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                endpoint: "http://collector:4317".to_string(),
                protocol: "grpc".to_string(),
                batch_size: 500,
                flush_interval_ms: 1000,
                timeout_ms: 3000,
                service_name: "aurora".to_string(),
                log_level: "all".to_string(),
                ..Default::default()
            })
            .is_ok()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                endpoint: "".to_string(),
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                batch_size: 0,
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                batch_size: 6000,
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                flush_interval_ms: 50,
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                timeout_ms: 50,
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                service_name: "".to_string(),
                ..Default::default()
            })
            .is_err()
        );

        assert!(
            OtlpLogsExporter::new(OtlpLogsConfig {
                log_level: "verbose".to_string(),
                ..Default::default()
            })
            .is_err()
        );
    }

    #[tokio::test]
    async fn test_otlp_logs_grpc_connection_timeout_and_https() {
        // Test 1: Bounded connection timeout against non-routable IP (TEST-NET-1: 192.0.2.1)
        let exporter = OtlpLogsExporter::new(OtlpLogsConfig {
            enabled: true,
            endpoint: "http://192.0.2.1:4317".to_string(),
            protocol: "grpc".to_string(),
            timeout_ms: 200,
            ..Default::default()
        })
        .unwrap();

        let req = ExportLogsServiceRequest::default();
        let start = std::time::Instant::now();
        let res = exporter.export_grpc(req.clone()).await;
        let elapsed = start.elapsed();

        assert!(res.is_err());
        // Verify it was bounded promptly by timeout (~200ms) and did not hang
        assert!(elapsed < Duration::from_millis(1500));

        // Test 2: HTTPS TLS configuration builds properly without error
        let https_exporter = OtlpLogsExporter::new(OtlpLogsConfig {
            enabled: true,
            endpoint: "https://127.0.0.1:4317".to_string(),
            protocol: "grpc".to_string(),
            timeout_ms: 200,
            ..Default::default()
        })
        .unwrap();
        // Connection will fail because no server on port 4317 with TLS, but tonic TLS config succeeds
        let res_https = https_exporter.export_grpc(req).await;
        assert!(res_https.is_err());
    }
}
