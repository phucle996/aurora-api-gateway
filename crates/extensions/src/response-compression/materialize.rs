//! Response Compression Materializer
//!
//! Enforces the "Dumb Pipe" NGINX architectural invariant:
//! NGINX server block remains purely a listener and upstream router.
//! Response compression is fully executed within Aurora Rust Egress Filter via SHM RCU.

use crate::response_compression::policy::ResponseCompressionConfig;
use serde_json::{Map, Value};

/// Materializes response compression configuration into active policy.
///
/// Ensures zero NGINX compression directives are emitted into `server.conf`.
pub fn materialize(
    config: &Map<String, Value>,
    _server: &mut String,
    _has_server: &mut bool,
) -> Result<ResponseCompressionConfig, String> {
    let val = Value::Object(config.clone());
    let parsed: ResponseCompressionConfig = serde_json::from_value(val)
        .map_err(|err| format!("invalid response compression config: {err}"))?;

    parsed.validate()?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_materialize_keeps_nginx_conf_clean() {
        let mut server = String::new();
        let mut has_server = false;
        let config: Map<String, Value> = serde_json::from_str(r#"{
            "enabled": true,
            "min_length": 2048,
            "prefer_algorithms": ["zstd", "br", "gzip"]
        }"#).unwrap();

        let cfg = materialize(&config, &mut server, &mut has_server).unwrap();
        assert_eq!(cfg.min_length, 2048);
        assert!(!has_server);
        assert!(server.is_empty(), "NGINX conf must remain clean without gzip directives");
    }
}
