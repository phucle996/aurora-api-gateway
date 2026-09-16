use opentelemetry_proto::tonic::common::v1::{
    AnyValue, KeyValue, any_value::Value as AnyValueUnion,
};
use opentelemetry_proto::tonic::logs::v1::{LogRecord, SeverityNumber};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

struct OptF64Visitor;

impl<'de> serde::de::Visitor<'de> for OptF64Visitor {
    type Value = Option<f64>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a float, an integer, a string representation of a float, or null")
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(None)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(None)
    }

    fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Some(v))
    }

    fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Some(v as f64))
    }

    fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(Some(v as f64))
    }

    fn visit_str<E>(self, s: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        let trimmed = s.trim();
        if trimmed.is_empty() || trimmed == "-" {
            Ok(None)
        } else {
            Ok(trimmed.parse::<f64>().ok())
        }
    }
}

fn deserialize_opt_f64_lenient<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    deserializer.deserialize_any(OptF64Visitor)
}

fn deserialize_opt_non_empty_str<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(deserializer)?;
    match opt {
        Some(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() || trimmed == "-" {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        None => Ok(None),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayLogEntry {
    #[serde(default, alias = "remote_addr")]
    pub client_ip: Option<String>,
    #[serde(default, alias = "request_method")]
    pub method: Option<String>,
    #[serde(default, alias = "request_uri")]
    pub uri: Option<String>,
    #[serde(default)]
    pub status: Option<u16>,
    #[serde(default, deserialize_with = "deserialize_opt_f64_lenient")]
    pub duration_ms: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_opt_f64_lenient")]
    pub request_time: Option<f64>,
    #[serde(default, alias = "body_bytes_sent")]
    pub bytes_sent: Option<u64>,
    #[serde(default, alias = "http_user_agent")]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub waf_action: Option<String>,
    #[serde(default)]
    pub waf_rule_id: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub timestamp_unix_nano: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_non_empty_str",
        skip_serializing_if = "Option::is_none"
    )]
    pub request_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_opt_non_empty_str",
        skip_serializing_if = "Option::is_none"
    )]
    pub trace_id: Option<String>,
}

impl GatewayLogEntry {
    /// Returns the duration in milliseconds.
    ///
    /// If `duration_ms` is explicitly set, it takes precedence.
    /// Otherwise, if `request_time` is present (which NGINX outputs in fractional seconds, e.g. 0.250),
    /// it is converted to milliseconds (0.250s -> 250.0ms).
    pub fn effective_duration_ms(&self) -> Option<f64> {
        self.duration_ms
            .or_else(|| self.request_time.map(|s| s * 1000.0))
    }

    pub fn into_log_record(self, service_name: &str) -> LogRecord {
        let now_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);

        let time_unix_nano = self.timestamp_unix_nano.unwrap_or(now_nanos);

        let status = self.status.unwrap_or(200);
        let is_waf_blocked = self
            .waf_action
            .as_deref()
            .map(|a| a.eq_ignore_ascii_case("block"))
            .unwrap_or(false);

        let (severity_number, severity_text) = if status >= 500 || is_waf_blocked {
            (SeverityNumber::Error as i32, "ERROR".to_string())
        } else if status >= 400 {
            (SeverityNumber::Warn as i32, "WARN".to_string())
        } else {
            (SeverityNumber::Info as i32, "INFO".to_string())
        };

        let effective_dur = self.effective_duration_ms();
        let body_str = if let Some(msg) = self.message {
            msg
        } else {
            let m = self.method.as_deref().unwrap_or("GET");
            let u = self.uri.as_deref().unwrap_or("/");
            let d = effective_dur.unwrap_or(0.0);
            format!("{m} {u} -> {status} ({d:.2}ms)")
        };

        let make_str_attr = |k: &str, v: String| KeyValue {
            key: k.to_string(),
            value: Some(AnyValue {
                value: Some(AnyValueUnion::StringValue(v)),
            }),
            ..Default::default()
        };
        let make_int_attr = |k: &str, v: i64| KeyValue {
            key: k.to_string(),
            value: Some(AnyValue {
                value: Some(AnyValueUnion::IntValue(v)),
            }),
            ..Default::default()
        };
        let make_double_attr = |k: &str, v: f64| KeyValue {
            key: k.to_string(),
            value: Some(AnyValue {
                value: Some(AnyValueUnion::DoubleValue(v)),
            }),
            ..Default::default()
        };

        let mut attributes = Vec::with_capacity(14);
        attributes.push(make_str_attr("service.name", service_name.to_string()));
        attributes.push(make_str_attr(
            "telemetry.sdk.name",
            "aurora-waf".to_string(),
        ));

        if let Some(m) = self.method {
            attributes.push(make_str_attr("http.request.method", m));
        }
        if let Some(u) = self.uri {
            attributes.push(make_str_attr("url.path", u));
        }
        if let Some(s) = self.status {
            attributes.push(make_int_attr("http.response.status_code", s as i64));
        }
        if let Some(ip) = self.client_ip {
            attributes.push(make_str_attr("client.address", ip));
        }
        if let Some(d) = effective_dur {
            attributes.push(make_double_attr("http.request.duration_ms", d));
        }
        if let Some(b) = self.bytes_sent {
            attributes.push(make_int_attr("http.response.body.size", b as i64));
        }
        if let Some(h) = self.host {
            attributes.push(make_str_attr("server.address", h));
        }
        if let Some(ua) = self.user_agent {
            attributes.push(make_str_attr("user_agent.original", ua));
        }
        if let Some(a) = self.waf_action {
            attributes.push(make_str_attr("waf.action", a));
        }
        if let Some(r) = self.waf_rule_id {
            attributes.push(make_str_attr("waf.rule_id", r));
        }
        if let Some(ref rid) = self.request_id {
            attributes.push(make_str_attr("http.request.id", rid.clone()));
        }
        let trace_id_bytes = if let Some(ref tid) = self.trace_id {
            attributes.push(make_str_attr("trace_id", tid.clone()));
            hex::decode(tid).unwrap_or_default()
        } else {
            vec![]
        };

        LogRecord {
            time_unix_nano,
            observed_time_unix_nano: now_nanos,
            severity_number,
            severity_text,
            body: Some(AnyValue {
                value: Some(AnyValueUnion::StringValue(body_str)),
            }),
            attributes,
            dropped_attributes_count: 0,
            flags: 0,
            trace_id: trace_id_bytes,
            span_id: vec![],
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_time_conversion_to_ms() {
        let json =
            r#"{"request_method":"GET","request_uri":"/test","status":200,"request_time":0.25}"#;
        let entry: GatewayLogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.request_time, Some(0.25));
        assert_eq!(entry.duration_ms, None);
        assert_eq!(entry.effective_duration_ms(), Some(250.0));

        let record = entry.into_log_record("test-service");
        let dur_attr = record
            .attributes
            .iter()
            .find(|a| a.key == "http.request.duration_ms")
            .expect("duration attribute missing");
        match dur_attr.value.as_ref().unwrap().value.as_ref().unwrap() {
            AnyValueUnion::DoubleValue(d) => assert_eq!(*d, 250.0),
            other => panic!("expected DoubleValue, got {:?}", other),
        }
        match record.body.unwrap().value.unwrap() {
            AnyValueUnion::StringValue(s) => assert!(s.contains("250.00ms")),
            other => panic!("expected StringValue body, got {:?}", other),
        }
    }

    #[test]
    fn test_string_request_time_and_duration_ms() {
        let json_str = r#"{"request_time":"0.100","status":200}"#;
        let entry_str: GatewayLogEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry_str.effective_duration_ms(), Some(100.0));

        let json_direct = r#"{"duration_ms":12.5,"status":200}"#;
        let entry_direct: GatewayLogEntry = serde_json::from_str(json_direct).unwrap();
        assert_eq!(entry_direct.effective_duration_ms(), Some(12.5));

        // When both are present, duration_ms takes precedence
        let json_both = r#"{"request_time":0.25,"duration_ms":50.0,"status":200}"#;
        let entry_both: GatewayLogEntry = serde_json::from_str(json_both).unwrap();
        assert_eq!(entry_both.effective_duration_ms(), Some(50.0));

        // Dashes or uninitialized string numbers parse gracefully as None
        let json_dash = r#"{"request_time":"-","status":200}"#;
        let entry_dash: GatewayLogEntry = serde_json::from_str(json_dash).unwrap();
        assert_eq!(entry_dash.effective_duration_ms(), None);
    }
}
