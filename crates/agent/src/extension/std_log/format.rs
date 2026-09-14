use super::config::StdLogFormat;
use crate::logs::GatewayLogEntry;
use serde::Serialize;
use std::fmt::Write;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
struct JsonLogRecord<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<String>,
    level: &'a str,
    client_ip: &'a str,
    method: &'a str,
    uri: &'a str,
    status: u16,
    duration_ms: f64,
    bytes_sent: u64,
    host: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_agent: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    waf_action: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    waf_rule_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

pub fn get_severity(entry: &GatewayLogEntry) -> &'static str {
    let status = entry.status.unwrap_or(200);
    let is_waf_blocked = entry
        .waf_action
        .as_deref()
        .map(|a| a.eq_ignore_ascii_case("block"))
        .unwrap_or(false);

    if status >= 500 || is_waf_blocked {
        "ERROR"
    } else if status >= 400 {
        "WARN"
    } else {
        "INFO"
    }
}

pub fn format_entry(
    entry: &GatewayLogEntry,
    format: StdLogFormat,
    include_waf_details: bool,
) -> String {
    let severity = get_severity(entry);
    let client_ip = entry.client_ip.as_deref().unwrap_or("-");
    let method = entry.method.as_deref().unwrap_or("-");
    let uri = entry.uri.as_deref().unwrap_or("-");
    let status = entry.status.unwrap_or(200);
    let duration_ms = entry.effective_duration_ms().unwrap_or(0.0);
    let bytes_sent = entry.bytes_sent.unwrap_or(0);
    let host = entry.host.as_deref().unwrap_or("-");
    let user_agent = entry.user_agent.as_deref();

    let (waf_action, waf_rule_id) = if include_waf_details {
        (
            entry.waf_action.as_deref(),
            entry.waf_rule_id.as_deref().filter(|s| !s.is_empty()),
        )
    } else {
        (None, None)
    };

    match format {
        StdLogFormat::Json => {
            let timestamp = entry.timestamp_unix_nano.map(|nanos| {
                let secs = nanos / 1_000_000_000;
                let subsec_nanos = (nanos % 1_000_000_000) as u32;
                format!("{secs}.{subsec_nanos:09}")
            });

            let record = JsonLogRecord {
                timestamp,
                level: severity,
                client_ip,
                method,
                uri,
                status,
                duration_ms,
                bytes_sent,
                host,
                user_agent,
                waf_action,
                waf_rule_id,
                message: entry.message.as_deref(),
            };

            serde_json::to_string(&record).unwrap_or_else(|_| "{}".to_string())
        }
        StdLogFormat::Text => {
            let mut out = String::with_capacity(160);
            let _ = write!(
                out,
                "[{severity}] {method} {uri} {status} {duration_ms:.2}ms - {client_ip} host={host}"
            );
            if let Some(action) = waf_action {
                let _ = write!(out, " waf={action}");
                if let Some(rule) = waf_rule_id {
                    let _ = write!(out, " rule={rule}");
                }
            }
            if let Some(msg) = &entry.message {
                let _ = write!(out, " msg=\"{msg}\"");
            }
            out
        }
        StdLogFormat::Combined => {
            let secs = entry
                .timestamp_unix_nano
                .map(|nanos| nanos / 1_000_000_000)
                .unwrap_or_else(|| {
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0)
                });
            let mut out = String::with_capacity(160);
            let _ = write!(out, "{client_ip} - - ");
            format_combined_timestamp(secs, &mut out);
            out.push_str(" \"");
            escape_combined_field(method, &mut out);
            out.push(' ');
            escape_combined_field(uri, &mut out);
            let _ = write!(out, " HTTP/1.1\" {status} {bytes_sent} \"-\" \"");
            if let Some(ua) = user_agent {
                escape_combined_field(ua, &mut out);
            } else {
                out.push('-');
            }
            out.push('"');
            out
        }
    }
}

fn format_combined_timestamp(secs: u64, out: &mut String) {
    let days = (secs / 86400) as i64;
    let time_of_day = (secs % 86400) as u32;
    let hour = time_of_day / 3600;
    let min = (time_of_day % 3600) / 60;
    let sec = time_of_day % 60;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month_str = MONTHS
        .get(m.saturating_sub(1) as usize)
        .copied()
        .unwrap_or("Jan");
    let _ = write!(
        out,
        "[{d:02}/{month_str}/{y:04}:{hour:02}:{min:02}:{sec:02} +0000]"
    );
}

fn escape_combined_field(s: &str, out: &mut String) {
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 32 => {
                let _ = write!(out, "\\x{:02x}", c as u32);
            }
            c => out.push(c),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_json() {
        let entry = GatewayLogEntry {
            client_ip: Some("192.168.1.10".to_string()),
            method: Some("GET".to_string()),
            uri: Some("/api/v1/test".to_string()),
            status: Some(200),
            duration_ms: Some(5.25),
            bytes_sent: Some(1024),
            host: Some("example.com".to_string()),
            user_agent: Some("curl/7.88".to_string()),
            waf_action: Some("allow".to_string()),
            waf_rule_id: None,
            ..Default::default()
        };

        let json_str = format_entry(&entry, StdLogFormat::Json, true);
        assert!(json_str.contains("\"level\":\"INFO\""));
        assert!(json_str.contains("\"status\":200"));
        assert!(json_str.contains("\"waf_action\":\"allow\""));

        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(parsed["client_ip"], "192.168.1.10");
        assert_eq!(parsed["duration_ms"], 5.25);
    }

    #[test]
    fn test_format_text_waf_block() {
        let entry = GatewayLogEntry {
            client_ip: Some("10.0.0.99".to_string()),
            method: Some("POST".to_string()),
            uri: Some("/login".to_string()),
            status: Some(403),
            duration_ms: Some(0.42),
            bytes_sent: Some(120),
            host: Some("auth.local".to_string()),
            waf_action: Some("block".to_string()),
            waf_rule_id: Some("sqli-942100".to_string()),
            ..Default::default()
        };

        let text_str = format_entry(&entry, StdLogFormat::Text, true);
        assert!(text_str.contains("[ERROR] POST /login 403 0.42ms"));
        assert!(text_str.contains("waf=block rule=sqli-942100"));
    }

    #[test]
    fn test_format_combined() {
        let entry = GatewayLogEntry {
            client_ip: Some("127.0.0.1".to_string()),
            method: Some("GET".to_string()),
            uri: Some("/index.html".to_string()),
            status: Some(200),
            bytes_sent: Some(500),
            user_agent: Some("Mozilla/5.0 \"special\" \\agent".to_string()),
            timestamp_unix_nano: Some(1_789_378_800_000_000_000), // 2026-09-14 09:40:00 UTC
            ..Default::default()
        };

        let combined = format_entry(&entry, StdLogFormat::Combined, false);
        assert!(combined.starts_with("127.0.0.1 - - [14/Sep/2026:09:40:00 +0000]"));
        assert!(combined.contains("\"GET /index.html HTTP/1.1\" 200 500"));
        assert!(combined.ends_with("\"Mozilla/5.0 \\\"special\\\" \\\\agent\""));

        for (secs, expected) in [
            (0, "[01/Jan/1970:00:00:00 +0000]"),
            (951_782_400, "[29/Feb/2000:00:00:00 +0000]"),
            (1_709_164_800, "[29/Feb/2024:00:00:00 +0000]"),
            (1_709_251_200, "[01/Mar/2024:00:00:00 +0000]"),
            (1_767_139_200, "[31/Dec/2025:00:00:00 +0000]"),
            (1_767_225_600, "[01/Jan/2026:00:00:00 +0000]"),
            (1_772_064_000, "[26/Feb/2026:00:00:00 +0000]"),
        ] {
            let mut out = String::new();
            format_combined_timestamp(secs, &mut out);
            assert_eq!(out, expected);
        }
    }
}
