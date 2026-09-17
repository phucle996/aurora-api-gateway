use crate::logs::GatewayLogEntry;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdLogFormat {
    Json,
    Text,
    Combined,
}

impl StdLogFormat {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "json" => Ok(Self::Json),
            "text" => Ok(Self::Text),
            "combined" => Ok(Self::Combined),
            other => Err(format!(
                "unsupported std-log format '{other}', must be 'json', 'text', or 'combined'"
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StdLogLevel {
    Info,
    Warn,
    Error,
    All,
}

impl StdLogLevel {
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

    pub fn allows(&self, entry: &GatewayLogEntry) -> bool {
        let is_waf_block = entry
            .waf_action
            .as_deref()
            .map(|a| a.eq_ignore_ascii_case("block"))
            .unwrap_or(false);

        let status = entry.status.unwrap_or(200);

        let level = if is_waf_block || status >= 500 {
            StdLogLevel::Error
        } else if status >= 400 {
            StdLogLevel::Warn
        } else {
            StdLogLevel::Info
        };

        match self {
            Self::All => true,
            Self::Info => true,
            Self::Warn => matches!(level, StdLogLevel::Warn | StdLogLevel::Error),
            Self::Error => matches!(level, StdLogLevel::Error),
        }
    }
}

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_std_log_format() -> String {
    "json".to_string()
}

fn default_std_log_level() -> String {
    "info".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct StdLogSpec {
    pub enabled: bool,
    #[serde(default = "default_std_log_format")]
    pub format: String,
    #[serde(default = "default_true")]
    pub split_streams: bool,
    #[serde(default = "default_std_log_level")]
    pub log_level: String,
    #[serde(default = "default_true")]
    pub include_waf_details: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StdLogConfig {
    pub enabled: bool,
    pub format: StdLogFormat,
    pub split_streams: bool,
    pub log_level: StdLogLevel,
    pub include_waf_details: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_parsing() {
        assert_eq!(StdLogFormat::parse("json").unwrap(), StdLogFormat::Json);
        assert_eq!(StdLogFormat::parse("TEXT").unwrap(), StdLogFormat::Text);
        assert_eq!(
            StdLogFormat::parse("combined").unwrap(),
            StdLogFormat::Combined
        );
        assert!(StdLogFormat::parse("yaml").is_err());
    }

    #[test]
    fn test_log_level_filter() {
        let entry_200 = GatewayLogEntry {
            status: Some(200),
            ..Default::default()
        };
        let entry_404 = GatewayLogEntry {
            status: Some(404),
            ..Default::default()
        };
        let entry_500 = GatewayLogEntry {
            status: Some(500),
            ..Default::default()
        };
        let entry_waf_block = GatewayLogEntry {
            status: Some(403),
            waf_action: Some("block".to_string()),
            ..Default::default()
        };

        // All allows everything
        assert!(StdLogLevel::All.allows(&entry_200));
        assert!(StdLogLevel::All.allows(&entry_404));
        assert!(StdLogLevel::All.allows(&entry_500));
        assert!(StdLogLevel::All.allows(&entry_waf_block));

        // Info allows all status codes
        assert!(StdLogLevel::Info.allows(&entry_200));
        assert!(StdLogLevel::Info.allows(&entry_404));
        assert!(StdLogLevel::Info.allows(&entry_500));
        assert!(StdLogLevel::Info.allows(&entry_waf_block));

        // Warn allows 4xx, 5xx, and WAF blocks, but rejects 200
        assert!(!StdLogLevel::Warn.allows(&entry_200));
        assert!(StdLogLevel::Warn.allows(&entry_404));
        assert!(StdLogLevel::Warn.allows(&entry_500));
        assert!(StdLogLevel::Warn.allows(&entry_waf_block));

        // Error only allows 5xx and WAF blocks
        assert!(!StdLogLevel::Error.allows(&entry_200));
        assert!(!StdLogLevel::Error.allows(&entry_404));
        assert!(StdLogLevel::Error.allows(&entry_500));
        assert!(StdLogLevel::Error.allows(&entry_waf_block));
    }
}
