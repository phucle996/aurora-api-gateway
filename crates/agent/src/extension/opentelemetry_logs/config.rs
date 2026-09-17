use opentelemetry_proto::tonic::logs::v1::SeverityNumber;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtlpProtocol {
    Http,
    Grpc,
}

impl OtlpProtocol {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "http" => Ok(Self::Http),
            "grpc" => Ok(Self::Grpc),
            other => Err(format!(
                "unsupported otlp protocol '{other}', must be 'http' or 'grpc'"
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogLevelFilter {
    Info,
    Warn,
    Error,
    All,
}

impl LogLevelFilter {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "info" => Ok(Self::Info),
            "warn" => Ok(Self::Warn),
            "error" => Ok(Self::Error),
            "all" => Ok(Self::All),
            other => Err(format!(
                "unsupported log_level '{other}', must be 'info', 'warn', 'error', or 'all'"
            )),
        }
    }

    pub fn allows(&self, severity: SeverityNumber) -> bool {
        match self {
            Self::All => true,
            Self::Info => (severity as i32) >= (SeverityNumber::Info as i32),
            Self::Warn => (severity as i32) >= (SeverityNumber::Warn as i32),
            Self::Error => (severity as i32) >= (SeverityNumber::Error as i32),
        }
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OtlpLogsConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub protocol: String,
    pub batch_size: usize,
    pub flush_interval_ms: u64,
    pub timeout_ms: u64,
    pub service_name: String,
    pub log_level: String,
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_logs_protocol_parsing() {
        assert_eq!(OtlpProtocol::parse("http").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("grpc").unwrap(), OtlpProtocol::Grpc);
        assert_eq!(OtlpProtocol::parse("HTTP").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("GRPC").unwrap(), OtlpProtocol::Grpc);
        assert!(OtlpProtocol::parse("udp").is_err());
        assert!(OtlpProtocol::parse("").is_err());
    }

    #[test]
    fn test_otlp_logs_level_filter() {
        assert_eq!(LogLevelFilter::parse("info").unwrap(), LogLevelFilter::Info);
        assert_eq!(LogLevelFilter::parse("warn").unwrap(), LogLevelFilter::Warn);
        assert_eq!(
            LogLevelFilter::parse("error").unwrap(),
            LogLevelFilter::Error
        );
        assert_eq!(LogLevelFilter::parse("all").unwrap(), LogLevelFilter::All);
        assert!(LogLevelFilter::parse("debug").is_err());

        let info_filter = LogLevelFilter::Info;
        assert!(info_filter.allows(SeverityNumber::Info));
        assert!(info_filter.allows(SeverityNumber::Warn));
        assert!(info_filter.allows(SeverityNumber::Error));

        let warn_filter = LogLevelFilter::Warn;
        assert!(!warn_filter.allows(SeverityNumber::Info));
        assert!(warn_filter.allows(SeverityNumber::Warn));
        assert!(warn_filter.allows(SeverityNumber::Error));

        let error_filter = LogLevelFilter::Error;
        assert!(!error_filter.allows(SeverityNumber::Info));
        assert!(!error_filter.allows(SeverityNumber::Warn));
        assert!(error_filter.allows(SeverityNumber::Error));
    }
}
