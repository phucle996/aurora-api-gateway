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

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OtlpTracingConfig {
    pub enabled: bool,
    pub endpoint: String,
    pub protocol: String,
    pub sample_rate: f64,
    pub batch_size: usize,
    pub flush_interval_ms: u64,
    pub timeout_ms: u64,
    pub service_name: String,
}

impl Default for OtlpTracingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            endpoint: "http://127.0.0.1:4318".to_string(),
            protocol: "http".to_string(),
            sample_rate: 1.0,
            batch_size: 100,
            flush_interval_ms: 2000,
            timeout_ms: 5000,
            service_name: "aurora-gateway".to_string(),
        }
    }
}

/// Deterministic TraceIdRatioBased sampler adhering to the OpenTelemetry specification.
#[derive(Debug, Clone, Copy)]
pub struct Sampler {
    sample_rate: f64,
    id_upper_bound: u64,
}

impl Sampler {
    pub fn new(sample_rate: f64) -> Self {
        let clamped = sample_rate.clamp(0.0, 1.0);
        let id_upper_bound = if clamped >= 1.0 {
            u64::MAX
        } else if clamped <= 0.0 {
            0
        } else {
            (clamped * (u64::MAX as f64)) as u64
        };
        Self {
            sample_rate: clamped,
            id_upper_bound,
        }
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// Evaluates sampling decision against the low 8 bytes of the 16-byte trace_id.
    pub fn should_sample(&self, trace_id: &[u8; 16]) -> bool {
        if self.sample_rate >= 1.0 {
            return true;
        }
        if self.sample_rate <= 0.0 {
            return false;
        }
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&trace_id[8..16]);
        let val = u64::from_be_bytes(bytes);
        val <= self.id_upper_bound
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otlp_tracing_protocol_parsing() {
        assert_eq!(OtlpProtocol::parse("http").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("HTTP ").unwrap(), OtlpProtocol::Http);
        assert_eq!(OtlpProtocol::parse("grpc").unwrap(), OtlpProtocol::Grpc);
        assert_eq!(OtlpProtocol::parse(" gRPC").unwrap(), OtlpProtocol::Grpc);
        assert!(OtlpProtocol::parse("tcp").is_err());
        assert!(OtlpProtocol::parse("").is_err());
    }

    #[test]
    fn test_sampler_boundary_conditions() {
        let always_on = Sampler::new(1.0);
        let always_off = Sampler::new(0.0);
        let mut trace_id = [0u8; 16];
        trace_id[15] = 0xFF;

        assert!(always_on.should_sample(&trace_id));
        assert!(!always_off.should_sample(&trace_id));

        // 50% sampler
        let half = Sampler::new(0.5);
        let mut low_id = [0u8; 16];
        low_id[8] = 0x10; // low value
        let mut high_id = [0u8; 16];
        high_id[8] = 0xF0; // high value

        assert!(half.should_sample(&low_id));
        assert!(!half.should_sample(&high_id));
    }
}
