use super::collector::NodeMetrics;

/// Format NodeMetrics into standard Prometheus Exposition text format.
/// Adheres strictly to standard naming conventions WITHOUT prefix 'aurora_'.
pub fn format_prometheus(node_id: &str, m: &NodeMetrics) -> String {
    let mut out = String::with_capacity(1024);

    // 1. Connection Gauges
    out.push_str("# HELP http_connections_active Number of active client connections\n");
    out.push_str("# TYPE http_connections_active gauge\n");
    out.push_str(&format!(
        "http_connections_active{{node_id=\"{}\"}} {}\n\n",
        node_id, m.active_connections
    ));

    out.push_str("# HELP http_connections_reading Number of connections reading request headers\n");
    out.push_str("# TYPE http_connections_reading gauge\n");
    out.push_str(&format!(
        "http_connections_reading{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_reading
    ));

    out.push_str("# HELP http_connections_writing Number of connections writing response\n");
    out.push_str("# TYPE http_connections_writing gauge\n");
    out.push_str(&format!(
        "http_connections_writing{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_writing
    ));

    out.push_str("# HELP http_connections_waiting Number of idle keepalive connections\n");
    out.push_str("# TYPE http_connections_waiting gauge\n");
    out.push_str(&format!(
        "http_connections_waiting{{node_id=\"{}\"}} {}\n\n",
        node_id, m.connections_waiting
    ));

    // 2. Request Counter
    out.push_str("# HELP http_requests_total Total number of HTTP requests processed\n");
    out.push_str("# TYPE http_requests_total counter\n");
    out.push_str(&format!(
        "http_requests_total{{node_id=\"{}\"}} {}\n\n",
        node_id, m.requests_total
    ));

    // 3. System Utilization Gauges
    out.push_str(
        "# HELP system_cpu_utilization_ratio Current CPU utilization ratio (0.0 to 1.0)\n",
    );
    out.push_str("# TYPE system_cpu_utilization_ratio gauge\n");
    out.push_str(&format!(
        "system_cpu_utilization_ratio{{node_id=\"{}\"}} {:.4}\n\n",
        node_id, m.cpu_utilization
    ));

    out.push_str(
        "# HELP system_memory_utilization_ratio Current Memory utilization ratio (0.0 to 1.0)\n",
    );
    out.push_str("# TYPE system_memory_utilization_ratio gauge\n");
    out.push_str(&format!(
        "system_memory_utilization_ratio{{node_id=\"{}\"}} {:.4}\n\n",
        node_id, m.memory_utilization
    ));

    out.push_str("# HELP system_memory_used_bytes Memory used in bytes\n");
    out.push_str("# TYPE system_memory_used_bytes gauge\n");
    out.push_str(&format!(
        "system_memory_used_bytes{{node_id=\"{}\"}} {}\n\n",
        node_id, m.memory_used_bytes
    ));

    out.push_str("# HELP system_memory_total_bytes Total system memory in bytes\n");
    out.push_str("# TYPE system_memory_total_bytes gauge\n");
    out.push_str(&format!(
        "system_memory_total_bytes{{node_id=\"{}\"}} {}\n\n",
        node_id, m.memory_total_bytes
    ));

    // 4. Gateway HTTP Requests by Status Class
    let g = &m.gateway;
    out.push_str("# HELP gateway_http_requests_total Total HTTP requests processed by Gateway\n");
    out.push_str("# TYPE gateway_http_requests_total counter\n");
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"2xx\"}} {}\n",
        g.http.status_2xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"3xx\"}} {}\n",
        g.http.status_3xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"4xx\"}} {}\n",
        g.http.status_4xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"5xx\"}} {}\n",
        g.http.status_5xx
    ));
    out.push_str(&format!(
        "gateway_http_requests_total{{node_id=\"{node_id}\",status=\"other\"}} {}\n\n",
        g.http.status_other
    ));

    // 5. Gateway HTTP Request Latency Histogram
    out.push_str("# HELP gateway_http_request_duration_seconds HTTP request duration in seconds\n");
    out.push_str("# TYPE gateway_http_request_duration_seconds histogram\n");
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.001\"}} {}\n",
        g.http.duration_bucket_1ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.005\"}} {}\n",
        g.http.duration_bucket_5ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.010\"}} {}\n",
        g.http.duration_bucket_10ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.050\"}} {}\n",
        g.http.duration_bucket_50ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.100\"}} {}\n",
        g.http.duration_bucket_100ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"0.500\"}} {}\n",
        g.http.duration_bucket_500ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"1.000\"}} {}\n",
        g.http.duration_bucket_1000ms
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_bucket{{node_id=\"{node_id}\",le=\"+Inf\"}} {}\n",
        g.http.duration_bucket_inf
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_sum{{node_id=\"{node_id}\"}} {:.3}\n",
        g.http.duration_sum_ms as f64 / 1000.0
    ));
    out.push_str(&format!(
        "gateway_http_request_duration_seconds_count{{node_id=\"{node_id}\"}} {}\n\n",
        g.http.requests_total
    ));

    // 6. Core WAF Decisions
    out.push_str("# HELP gateway_waf_evaluations_total Core WAF evaluations\n");
    out.push_str("# TYPE gateway_waf_evaluations_total counter\n");
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"allow\"}} {}\n",
        g.waf.allow
    ));
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"block\"}} {}\n",
        g.waf.block
    ));
    out.push_str(&format!(
        "gateway_waf_evaluations_total{{node_id=\"{node_id}\",action=\"audit\"}} {}\n\n",
        g.waf.audit
    ));

    // 7. Rate Limiting Decisions
    out.push_str("# HELP gateway_ratelimit_requests_total Rate limit decisions\n");
    out.push_str("# TYPE gateway_ratelimit_requests_total counter\n");
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"allowed\"}} {}\n",
        g.ratelimit.allowed
    ));
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"throttled\"}} {}\n",
        g.ratelimit.throttled
    ));
    out.push_str(&format!(
        "gateway_ratelimit_requests_total{{node_id=\"{node_id}\",action=\"rejected\"}} {}\n\n",
        g.ratelimit.rejected
    ));

    // 8. JWT Authentication Decisions
    out.push_str("# HELP gateway_jwt_validations_total JWT authentication decisions\n");
    out.push_str("# TYPE gateway_jwt_validations_total counter\n");
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"valid\"}} {}\n",
        g.jwt.valid
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"invalid\"}} {}\n",
        g.jwt.invalid
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"expired\"}} {}\n",
        g.jwt.expired
    ));
    out.push_str(&format!(
        "gateway_jwt_validations_total{{node_id=\"{node_id}\",status=\"missing\"}} {}\n\n",
        g.jwt.missing
    ));

    // 9. IP Restriction Decisions
    out.push_str("# HELP gateway_ip_restriction_evaluations_total IP restriction decisions\n");
    out.push_str("# TYPE gateway_ip_restriction_evaluations_total counter\n");
    out.push_str(&format!(
        "gateway_ip_restriction_evaluations_total{{node_id=\"{node_id}\",action=\"allow\"}} {}\n",
        g.ip_restriction.allow
    ));
    out.push_str(&format!(
        "gateway_ip_restriction_evaluations_total{{node_id=\"{node_id}\",action=\"block\"}} {}\n\n",
        g.ip_restriction.block
    ));

    // 10. Routing Extensions
    out.push_str("# HELP gateway_canary_requests_total Canary release routing decisions\n");
    out.push_str("# TYPE gateway_canary_requests_total counter\n");
    out.push_str(&format!(
        "gateway_canary_requests_total{{node_id=\"{node_id}\",slot=\"baseline\"}} {}\n",
        g.canary.baseline
    ));
    out.push_str(&format!(
        "gateway_canary_requests_total{{node_id=\"{node_id}\",slot=\"canary\"}} {}\n\n",
        g.canary.canary
    ));

    out.push_str("# HELP gateway_traffic_split_requests_total Traffic split routing decisions\n");
    out.push_str("# TYPE gateway_traffic_split_requests_total counter\n");
    out.push_str(&format!(
        "gateway_traffic_split_requests_total{{node_id=\"{node_id}\",branch=\"primary\"}} {}\n",
        g.traffic_split.primary
    ));
    out.push_str(&format!(
        "gateway_traffic_split_requests_total{{node_id=\"{node_id}\",branch=\"secondary\"}} {}\n\n",
        g.traffic_split.secondary
    ));

    out.push_str(
        "# HELP gateway_conn_limit_rejected_total Connection limit rejected connections\n",
    );
    out.push_str("# TYPE gateway_conn_limit_rejected_total counter\n");
    out.push_str(&format!(
        "gateway_conn_limit_rejected_total{{node_id=\"{node_id}\"}} {}\n\n",
        g.conn_limit.rejected
    ));

    out.push_str("# HELP gateway_request_termination_total Terminated requests\n");
    out.push_str("# TYPE gateway_request_termination_total counter\n");
    out.push_str(&format!(
        "gateway_request_termination_total{{node_id=\"{node_id}\"}} {}\n\n",
        g.termination.triggered
    ));

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use aurora_engine::shm::GatewayMetricsSnapshot;

    #[test]
    fn test_format_prometheus_no_aurora_prefix() {
        let m = NodeMetrics {
            cpu_utilization: 0.1523,
            memory_utilization: 0.4567,
            memory_used_bytes: 4000000000,
            memory_total_bytes: 8000000000,
            active_connections: 42,
            connections_reading: 2,
            connections_writing: 10,
            connections_waiting: 30,
            requests_total: 5000,
            gateway: GatewayMetricsSnapshot::default(),
        };

        let formatted = format_prometheus("node-test-01", &m);

        assert!(formatted.contains("http_connections_active{node_id=\"node-test-01\"} 42"));
        assert!(formatted.contains("http_connections_reading{node_id=\"node-test-01\"} 2"));
        assert!(formatted.contains("http_connections_writing{node_id=\"node-test-01\"} 10"));
        assert!(formatted.contains("http_connections_waiting{node_id=\"node-test-01\"} 30"));
        assert!(formatted.contains("http_requests_total{node_id=\"node-test-01\"} 5000"));
        assert!(
            formatted.contains("system_cpu_utilization_ratio{node_id=\"node-test-01\"} 0.1523")
        );
        assert!(
            formatted.contains("system_memory_utilization_ratio{node_id=\"node-test-01\"} 0.4567")
        );

        // Crucial invariant: Absolutely NO aurora_ prefix in metric names
        assert!(!formatted.contains("aurora_"));
    }

    #[test]
    fn test_format_prometheus_with_gateway_metrics() {
        let mut m = NodeMetrics::default();
        m.gateway.http.requests_total = 100;
        m.gateway.http.status_2xx = 95;
        m.gateway.http.status_4xx = 5;
        m.gateway.http.duration_bucket_5ms = 80;
        m.gateway.http.duration_bucket_inf = 100;
        m.gateway.http.duration_sum_ms = 450;
        m.gateway.ratelimit.rejected = 3;
        m.gateway.jwt.valid = 90;
        m.gateway.jwt.invalid = 2;
        m.gateway.canary.canary = 20;

        let formatted = format_prometheus("node-01", &m);
        assert!(
            formatted
                .contains("gateway_http_requests_total{node_id=\"node-01\",status=\"2xx\"} 95")
        );
        assert!(
            formatted.contains("gateway_http_requests_total{node_id=\"node-01\",status=\"4xx\"} 5")
        );
        assert!(formatted.contains(
            "gateway_http_request_duration_seconds_bucket{node_id=\"node-01\",le=\"0.005\"} 80"
        ));
        assert!(
            formatted
                .contains("gateway_http_request_duration_seconds_sum{node_id=\"node-01\"} 0.450")
        );
        assert!(formatted.contains(
            "gateway_ratelimit_requests_total{node_id=\"node-01\",action=\"rejected\"} 3"
        ));
        assert!(
            formatted
                .contains("gateway_jwt_validations_total{node_id=\"node-01\",status=\"valid\"} 90")
        );
        assert!(
            formatted
                .contains("gateway_canary_requests_total{node_id=\"node-01\",slot=\"canary\"} 20")
        );
    }
}
