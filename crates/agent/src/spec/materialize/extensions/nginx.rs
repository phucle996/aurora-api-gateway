use crate::spec::extensions::ExtensionInstanceSpec;
use crate::spec::materialize::extensions::common::{
    array, boolean, nginx_fragment, nginx_header_name, nginx_quoted,
    nginx_request_header_variable, object, required_string, string, string_or, strings,
    unsigned, unsigned_or,
};
use serde_json::{Map, Value, json};

pub struct NginxDirectiveSink<'a> {
    pub modules: &'a mut String,
    pub has_modules: &'a mut bool,
    pub http: &'a mut String,
    pub has_http: &'a mut bool,
    pub server: &'a mut String,
    pub has_server: &'a mut bool,
}

impl<'a> NginxDirectiveSink<'a> {
    pub fn push_module(&mut self, directive: &str) {
        self.modules.push_str(directive);
        *self.has_modules = true;
    }

    pub fn push_http(&mut self, directive: &str) {
        self.http.push_str(directive);
        *self.has_http = true;
    }

    pub fn push_server(&mut self, directive: &str) {
        self.server.push_str(directive);
        *self.has_server = true;
    }
}

pub fn materialize(
    renderer: &str,
    instance: &ExtensionInstanceSpec,
    config: &Map<String, Value>,
    sink: &mut NginxDirectiveSink<'_>,
) -> Result<(), String> {
    match renderer {
        "nginx-brotli" => {
            sink.push_module("load_module /opt/aurora-dependencies/brotli/ngx_http_brotli_filter_module.so;\n");
            sink.push_module("load_module /opt/aurora-dependencies/brotli/ngx_http_brotli_static_module.so;\n");
            sink.push_server("brotli on;\n");
            if let Some(level) = unsigned(config, "quality") {
                sink.push_server(&format!("brotli_comp_level {level};\n"));
            }
            sink.push_server("brotli_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n");
        }
        "nginx-rate-limit-local" => {
            sink.push_http(&format!(
                "limit_req_zone $binary_remote_addr zone=aurora_rate_limit_local:10m rate={}r/s;\n",
                unsigned_or(config, "refill_rate", 100).max(1)
            ));
            sink.push_server(&format!(
                "limit_req_status {};\nlimit_req zone=aurora_rate_limit_local burst={} nodelay;\n",
                unsigned_or(config, "rejected_code", 429),
                unsigned_or(config, "capacity", 1000)
            ));
        }
        "nginx-connection-limit" => {
            sink.push_http("limit_conn_zone $binary_remote_addr zone=aurora_conn_limit:10m;\n");
            sink.push_server(&format!(
                "limit_conn_status {};\nlimit_conn aurora_conn_limit {};\n",
                unsigned_or(config, "rejected_code", 503),
                unsigned_or(config, "max_connections_per_ip", 50)
            ));
        }
        "nginx-cors" => {
            let allow_credentials = boolean(config, "allow_credentials").unwrap_or(false);
            let origin = if allow_credentials {
                "$http_origin".to_string()
            } else {
                strings(config, "allow_origins")
                    .and_then(|items| (items.len() == 1).then(|| items[0].clone()))
                    .unwrap_or_else(|| "$http_origin".to_string())
            };
            let methods = strings(config, "allow_methods")
                .map(|items| items.join(", "))
                .unwrap_or_else(|| "GET, POST, PUT, DELETE, PATCH, OPTIONS".to_string());
            let headers = strings(config, "allow_headers")
                .map(|items| items.join(", "))
                .unwrap_or_else(|| "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,X-API-Key,X-Request-ID".to_string());
            sink.push_server(&format!(
                "add_header Access-Control-Allow-Origin {} always;\n",
                nginx_quoted(&origin, "allow_origins")?
            ));
            sink.push_server(&format!(
                "add_header Access-Control-Allow-Methods {} always;\n",
                nginx_quoted(&methods, "allow_methods")?
            ));
            sink.push_server(&format!(
                "add_header Access-Control-Allow-Headers {} always;\n",
                nginx_quoted(&headers, "allow_headers")?
            ));
            sink.push_server(&format!(
                "add_header Access-Control-Max-Age {} always;\n",
                unsigned_or(config, "max_age", 86400)
            ));
            if allow_credentials {
                sink.push_server("add_header Access-Control-Allow-Credentials \"true\" always;\n");
            }
            if let Some(expose_headers) = strings(config, "expose_headers")
                && !expose_headers.is_empty()
            {
                sink.push_server(&format!(
                    "add_header Access-Control-Expose-Headers {} always;\n",
                    nginx_quoted(&expose_headers.join(", "), "expose_headers")?
                ));
            }
            sink.push_server("if ($request_method = 'OPTIONS') {\n    return 204;\n}\n");
        }
        "nginx-request-header-transform" => {
            append_header_transforms(sink.server, config, "proxy_set_header", "proxy_set_header")?;
            *sink.has_server = true;
        }
        "nginx-response-header-transform" => {
            append_header_transforms(sink.server, config, "add_header", "proxy_hide_header")?;
            *sink.has_server = true;
        }
        "nginx-maintenance" => {
            let message = string_or(
                config,
                "message",
                "Service undergoing planned maintenance.",
            );
            let body = serde_json::to_string(&json!({ "error": message }))
                .map_err(|error| format!("encode maintenance response: {error}"))?;
            sink.push_server(&format!(
                "add_header Retry-After {} always;\n",
                unsigned_or(config, "retry_after_secs", 300)
            ));
            if let Some(bypass_header) = string(config, "bypass_header") {
                let variable = nginx_request_header_variable(bypass_header)?;
                sink.push_server("set $aurora_maintenance 1;\n");
                sink.push_server(&format!(
                    "if ({variable}) {{\n    set $aurora_maintenance 0;\n}}\n"
                ));
                sink.push_server(&format!(
                    "if ($aurora_maintenance = 1) {{\n    return {} {};\n}}\n",
                    unsigned_or(config, "status_code", 503),
                    nginx_quoted(&body, "message")?
                ));
            } else {
                sink.push_server(&format!(
                    "return {} {};\n",
                    unsigned_or(config, "status_code", 503),
                    nginx_quoted(&body, "message")?
                ));
            }
        }
        "nginx-request-termination" => {
            if let Some(headers) = object(config, "headers") {
                for (name, value) in headers {
                    let value = value.as_str().ok_or_else(|| {
                        format!("request termination header {name} must be a string")
                    })?;
                    sink.push_server(&format!(
                        "add_header {} {} always;\n",
                        nginx_header_name(name)?,
                        nginx_quoted(value, "headers")?
                    ));
                }
            }
            sink.push_server(&format!(
                "return {} {};\n",
                unsigned_or(config, "status_code", 200),
                nginx_quoted(
                    &string_or(config, "body", r#"{"status":"mocked"}"#),
                    "body"
                )?
            ));
        }
        "nginx-uri-rewrite" => {
            if let Some(rules) = array(config, "rules") {
                for (index, rule) in rules.iter().enumerate() {
                    let rule = rule
                        .as_object()
                        .ok_or_else(|| format!("uri-rewrite rule {index} must be an object"))?;
                    let pattern = required_string(rule, "pattern", "uri-rewrite rule")?;
                    let replacement = required_string(rule, "replacement", "uri-rewrite rule")?;
                    sink.push_server(&format!(
                        "rewrite {} {} break;\n",
                        nginx_fragment(pattern, "rules.pattern")?,
                        nginx_fragment(replacement, "rules.replacement")?
                    ));
                }
            }
        }
        "nginx-request-size-limit" => {
            sink.push_server(&format!(
                "client_max_body_size {};\n",
                unsigned_or(config, "max_body_bytes", 1_048_576)
            ));
        }
        "nginx-response-buffering" => {
            sink.push_server("proxy_buffering off;\n");
        }
        "nginx-gzip" => {
            sink.push_server("gzip on;\n");
            if let Some(level) = unsigned(config, "level") {
                sink.push_server(&format!("gzip_comp_level {level};\n"));
            }
            sink.push_server("gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n");
        }
        "nginx-timeout-policy" => {
            if let Some(timeout) = unsigned(config, "connect_timeout_ms") {
                sink.push_server(&format!("proxy_connect_timeout {timeout}ms;\n"));
            }
            if let Some(timeout) = unsigned(config, "read_timeout_ms") {
                sink.push_server(&format!("proxy_read_timeout {timeout}ms;\n"));
            }
            if let Some(timeout) = unsigned(config, "write_timeout_ms") {
                sink.push_server(&format!("proxy_send_timeout {timeout}ms;\n"));
            }
        }
        _ => {
            return Err(format!(
                "extension instance {} uses unsupported renderer {renderer}",
                instance.instance_id
            ));
        }
    }
    Ok(())
}

fn append_header_transforms(
    server: &mut String,
    config: &Map<String, Value>,
    add_directive: &str,
    remove_directive: &str,
) -> Result<(), String> {
    if let Some(headers) = object(config, "add_headers") {
        for (name, value) in headers {
            let value = value
                .as_str()
                .ok_or_else(|| format!("extension header {name} must be a string"))?;
            server.push_str(&format!(
                "{add_directive} {} {}{};\n",
                nginx_header_name(name)?,
                nginx_quoted(value, "add_headers")?,
                if add_directive == "add_header" {
                    " always"
                } else {
                    ""
                }
            ));
        }
    }
    if let Some(headers) = strings(config, "remove_headers") {
        for name in headers {
            server.push_str(&format!(
                "{remove_directive} {}{};\n",
                nginx_header_name(&name)?,
                if remove_directive == "proxy_set_header" {
                    " \"\""
                } else {
                    ""
                }
            ));
        }
    }
    Ok(())
}
