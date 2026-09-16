use super::config::{OtlpProtocol, OtlpTracingConfig};
use anyhow::{Context, Result, anyhow};
use opentelemetry_proto::tonic::collector::trace::v1::{
    ExportTraceServiceRequest, trace_service_client::TraceServiceClient,
};
use opentelemetry_proto::tonic::common::v1::{
    AnyValue, InstrumentationScope, KeyValue, any_value::Value as AnyValueUnion,
};
use opentelemetry_proto::tonic::resource::v1::Resource;
use opentelemetry_proto::tonic::trace::v1::{ResourceSpans, ScopeSpans, Span};
use prost::Message;
use std::time::Duration;
use tracing::debug;

#[derive(Clone)]
pub struct OtlpTracingExporter {
    enabled: bool,
    endpoint: String,
    protocol: OtlpProtocol,
    sample_rate: f64,
    batch_size: usize,
    flush_interval: Duration,
    timeout: Duration,
    service_name: String,
    http_client: reqwest::Client,
}

impl OtlpTracingExporter {
    pub fn new(config: OtlpTracingConfig) -> Result<Self, String> {
        let protocol = OtlpProtocol::parse(&config.protocol)?;

        if config.enabled {
            if config.endpoint.trim().is_empty() {
                return Err("OTLP tracing endpoint cannot be empty when enabled".to_string());
            }
            if !(1..=5000).contains(&config.batch_size) {
                return Err(format!(
                    "OTLP tracing batch_size {} must be between 1 and 5000",
                    config.batch_size
                ));
            }
            if !(100..=60000).contains(&config.flush_interval_ms) {
                return Err(format!(
                    "OTLP tracing flush_interval_ms {} must be between 100 and 60000",
                    config.flush_interval_ms
                ));
            }
            if !(100..=60000).contains(&config.timeout_ms) {
                return Err(format!(
                    "OTLP tracing timeout_ms {} must be between 100 and 60000",
                    config.timeout_ms
                ));
            }
            if config.service_name.trim().is_empty() {
                return Err("OTLP tracing service_name cannot be empty when enabled".to_string());
            }
        }

        let timeout = Duration::from_millis(config.timeout_ms.max(100));
        let http_client = reqwest::Client::builder()
            .timeout(timeout)
            .tcp_keepalive(Some(Duration::from_secs(60)))
            .build()
            .map_err(|e| format!("build reqwest client for traces: {e}"))?;

        Ok(Self {
            enabled: config.enabled,
            endpoint: config.endpoint,
            protocol,
            sample_rate: config.sample_rate.clamp(0.0, 1.0),
            batch_size: config.batch_size.max(1),
            flush_interval: Duration::from_millis(config.flush_interval_ms.max(100)),
            timeout,
            service_name: config.service_name,
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

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
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

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    pub fn build_traces_request(
        &self,
        node_id: &str,
        spans: Vec<Span>,
    ) -> ExportTraceServiceRequest {
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
            name: "aurora.gateway.tracer".to_string(),
            version: "0.1.0".to_string(),
            ..Default::default()
        };

        ExportTraceServiceRequest {
            resource_spans: vec![ResourceSpans {
                resource: Some(resource),
                scope_spans: vec![ScopeSpans {
                    scope: Some(scope),
                    spans,
                    schema_url: String::new(),
                }],
                schema_url: String::new(),
            }],
        }
    }

    pub async fn export_batch(&self, node_id: &str, spans: Vec<Span>) -> Result<()> {
        if spans.is_empty() {
            return Ok(());
        }

        let count = spans.len();
        let request = self.build_traces_request(node_id, spans);

        match self.protocol {
            OtlpProtocol::Http => self.export_http(&request).await?,
            OtlpProtocol::Grpc => self.export_grpc(request).await?,
        }

        debug!(count = count, protocol = ?self.protocol, "OTLP traces batch exported successfully");
        Ok(())
    }

    async fn export_http(&self, request: &ExportTraceServiceRequest) -> Result<()> {
        let url = if self.endpoint.ends_with("/v1/traces") {
            self.endpoint.clone()
        } else {
            format!("{}/v1/traces", self.endpoint.trim_end_matches('/'))
        };

        let body_bytes = request.encode_to_vec();

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/x-protobuf")
            .body(body_bytes)
            .send()
            .await
            .context("send OTLP HTTP traces request")?;

        let status = response.status();
        if status.is_success() {
            debug!(status = %status, url = %url, "OTLP HTTP traces exported successfully");
            Ok(())
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(anyhow!(
                "OTLP Collector HTTP traces returned error {}: {}",
                status,
                body
            ))
        }
    }

    async fn export_grpc(&self, request: ExportTraceServiceRequest) -> Result<()> {
        let is_https = self.endpoint.starts_with("https://");
        let endpoint_str =
            if self.endpoint.starts_with("http://") || self.endpoint.starts_with("https://") {
                self.endpoint.clone()
            } else {
                format!("http://{}", self.endpoint)
            };

        let mut tonic_endpoint = tonic::transport::Endpoint::from_shared(endpoint_str)
            .context("invalid OTLP gRPC traces endpoint URL")?
            .connect_timeout(self.timeout)
            .timeout(self.timeout);

        if is_https {
            let tls_config = tonic::transport::ClientTlsConfig::new().with_webpki_roots();
            tonic_endpoint = tonic_endpoint
                .tls_config(tls_config)
                .context("configure TLS for OTLP gRPC traces endpoint")?;
        }

        let mut client =
            tokio::time::timeout(self.timeout, TraceServiceClient::connect(tonic_endpoint))
                .await
                .context("connect timeout to OTLP gRPC collector for traces")?
                .context("connect to OTLP gRPC collector for traces")?;

        let grpc_req = tonic::Request::new(request);
        tokio::time::timeout(self.timeout, client.export(grpc_req))
            .await
            .context("export timeout for OTLP gRPC traces")?
            .context("OTLP gRPC ExportTraces call failed")?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_traces_exporter_validation() {
        let mut cfg = OtlpTracingConfig::default();
        assert!(OtlpTracingExporter::new(cfg.clone()).is_ok());

        cfg.endpoint = "".to_string();
        assert!(OtlpTracingExporter::new(cfg.clone()).is_err());

        cfg.endpoint = "http://127.0.0.1:4318".to_string();
        cfg.batch_size = 0;
        assert!(OtlpTracingExporter::new(cfg.clone()).is_err());

        cfg.batch_size = 6000;
        assert!(OtlpTracingExporter::new(cfg.clone()).is_err());

        cfg.batch_size = 100;
        cfg.flush_interval_ms = 50;
        assert!(OtlpTracingExporter::new(cfg.clone()).is_err());

        cfg.flush_interval_ms = 1000;
        cfg.timeout_ms = 20;
        assert!(OtlpTracingExporter::new(cfg.clone()).is_err());

        cfg.timeout_ms = 3000;
        cfg.service_name = " ".to_string();
        assert!(OtlpTracingExporter::new(cfg).is_err());
    }

    #[test]
    fn test_build_traces_request_structure() {
        let exporter = OtlpTracingExporter::new(OtlpTracingConfig::default()).unwrap();
        let span = Span {
            trace_id: vec![1; 16],
            span_id: vec![2; 8],
            name: "HTTP GET /api/v1/users".to_string(),
            ..Default::default()
        };

        let req = exporter.build_traces_request("test-node-1", vec![span]);
        assert_eq!(req.resource_spans.len(), 1);
        let rs = &req.resource_spans[0];
        let res = rs.resource.as_ref().unwrap();
        assert_eq!(res.attributes.len(), 3);
        assert_eq!(res.attributes[0].key, "service.name");
        assert_eq!(res.attributes[1].key, "host.id");

        let ss = &rs.scope_spans[0];
        assert_eq!(ss.spans.len(), 1);
        assert_eq!(ss.spans[0].name, "HTTP GET /api/v1/users");
    }
}
