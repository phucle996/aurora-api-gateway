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

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OtlpMetricsConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub protocol: String,
    pub interval_secs: u64,
    pub timeout_ms: u64,
    pub service_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_protocol_parsing() {
        assert_eq!(OtlpProtocol::parse("http").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("grpc").unwrap(), OtlpProtocol::Grpc);
        assert_eq!(OtlpProtocol::parse("HTTP").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("GRPC").unwrap(), OtlpProtocol::Grpc);
        assert!(OtlpProtocol::parse("udp").is_err());
        assert!(OtlpProtocol::parse("").is_err());
    }
}
