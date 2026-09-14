use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use super::state::{
    TOTAL_ALLOWED, TOTAL_BLOCKED, TOTAL_EVALUATIONS, active_connections, shared_slot,
};

/// Sinh chuỗi văn bản định dạng chuẩn Prometheus / OpenMetrics.
pub fn format_prometheus_metrics(node_id: &str) -> String {
    let evals = shared_slot(0)
        .unwrap_or(&TOTAL_EVALUATIONS)
        .load(Ordering::Relaxed);
    let allowed = shared_slot(1)
        .unwrap_or(&TOTAL_ALLOWED)
        .load(Ordering::Relaxed);
    let blocked = shared_slot(2)
        .unwrap_or(&TOTAL_BLOCKED)
        .load(Ordering::Relaxed);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .unwrap_or(0);
    let ready = shared_slot(7).is_some_and(|v| {
        let sampled = v.load(Ordering::Acquire);
        sampled > 0 && now >= sampled && now - sampled <= 30
    });
    let cpu = shared_slot(4)
        .map(|v| f64::from_bits(v.load(Ordering::Relaxed)))
        .unwrap_or(f64::NAN);
    let mem = shared_slot(5)
        .map(|v| f64::from_bits(v.load(Ordering::Relaxed)))
        .unwrap_or(f64::NAN);
    let escaped = node_id
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    let node_id = escaped.as_str();

    let node_label = if node_id.is_empty() {
        "".to_string()
    } else {
        format!(",node_id=\"{}\"", node_id)
    };

    let mut out = String::with_capacity(1024);
    out.push_str(
        "# HELP aurora_waf_evaluations_total Total HTTP requests evaluated by Aurora WAF\n",
    );
    out.push_str("# TYPE aurora_waf_evaluations_total counter\n");
    out.push_str(&format!(
        "aurora_waf_evaluations_total{{action=\"allow\"{}}} {}\n",
        node_label, allowed
    ));
    out.push_str(&format!(
        "aurora_waf_evaluations_total{{action=\"block\"{}}} {}\n",
        node_label, blocked
    ));
    out.push_str(&format!(
        "aurora_waf_evaluations_total{{action=\"total\"{}}} {}\n",
        node_label, evals
    ));

    out.push_str("# HELP aurora_node_cpu_percent Current CPU usage percent of the node\n");
    out.push_str("# TYPE aurora_node_cpu_percent gauge\n");
    if ready && node_id.is_empty() {
        out.push_str(&format!("aurora_node_cpu_percent {:.2}\n", cpu));
    } else if ready {
        out.push_str(&format!(
            "aurora_node_cpu_percent{{node_id=\"{}\"}} {:.2}\n",
            node_id, cpu
        ));
    }

    out.push_str("# HELP aurora_node_memory_percent Current memory usage percent of the node\n");
    out.push_str("# TYPE aurora_node_memory_percent gauge\n");
    if ready && node_id.is_empty() {
        out.push_str(&format!("aurora_node_memory_percent {:.2}\n", mem));
    } else if ready {
        out.push_str(&format!(
            "aurora_node_memory_percent{{node_id=\"{}\"}} {:.2}\n",
            node_id, mem
        ));
    }

    if ready {
        let labels = if node_id.is_empty() {
            String::new()
        } else {
            format!("{{node_id=\"{node_id}\"}}")
        };
        if let Some(active) = active_connections() {
            out.push_str(&format!("# TYPE aurora_node_active_connections gauge\naurora_node_active_connections{labels} {active}\n"));
        }
        if let Some(rps) = shared_slot(6) {
            out.push_str(&format!("# TYPE aurora_node_requests_per_second gauge\naurora_node_requests_per_second{labels} {:.2}\n",f64::from_bits(rps.load(Ordering::Relaxed))));
        }
    }

    if let Some(m) = super::state::gateway_metrics() {
        let snap = m.snapshot();
        let label_prefix = if node_id.is_empty() {
            String::new()
        } else {
            format!(",node_id=\"{node_id}\"")
        };

        // HTTP Requests Total
        out.push_str("# HELP gateway_http_requests_total Total HTTP requests processed\n");
        out.push_str("# TYPE gateway_http_requests_total counter\n");
        out.push_str(&format!(
            "gateway_http_requests_total{{status=\"2xx\"{label_prefix}}} {}\n",
            snap.http_status_2xx
        ));
        out.push_str(&format!(
            "gateway_http_requests_total{{status=\"3xx\"{label_prefix}}} {}\n",
            snap.http_status_3xx
        ));
        out.push_str(&format!(
            "gateway_http_requests_total{{status=\"4xx\"{label_prefix}}} {}\n",
            snap.http_status_4xx
        ));
        out.push_str(&format!(
            "gateway_http_requests_total{{status=\"5xx\"{label_prefix}}} {}\n",
            snap.http_status_5xx
        ));
        out.push_str(&format!(
            "gateway_http_requests_total{{status=\"other\"{label_prefix}}} {}\n",
            snap.http_status_other
        ));

        // HTTP Duration Histogram
        out.push_str(
            "# HELP gateway_http_request_duration_seconds HTTP request duration in seconds\n",
        );
        out.push_str("# TYPE gateway_http_request_duration_seconds histogram\n");
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.001\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_1ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.005\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_5ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.010\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_10ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.050\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_50ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.100\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_100ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"0.500\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_500ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"1.000\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_1000ms
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_bucket{{le=\"+Inf\"{label_prefix}}} {}\n",
            snap.http_duration_bucket_inf
        ));
        let sum_sec = snap.http_duration_sum_ms as f64 / 1000.0;
        let sum_labels = if node_id.is_empty() {
            String::new()
        } else {
            format!("{{node_id=\"{node_id}\"}}")
        };
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_sum{sum_labels} {:.3}\n",
            sum_sec
        ));
        out.push_str(&format!(
            "gateway_http_request_duration_seconds_count{sum_labels} {}\n",
            snap.http_requests_total
        ));

        // Extension Metrics
        out.push_str("# HELP gateway_ratelimit_requests_total Rate limit decisions\n");
        out.push_str("# TYPE gateway_ratelimit_requests_total counter\n");
        out.push_str(&format!(
            "gateway_ratelimit_requests_total{{action=\"allowed\"{label_prefix}}} {}\n",
            snap.ratelimit_allowed
        ));
        out.push_str(&format!(
            "gateway_ratelimit_requests_total{{action=\"throttled\"{label_prefix}}} {}\n",
            snap.ratelimit_throttled
        ));
        out.push_str(&format!(
            "gateway_ratelimit_requests_total{{action=\"rejected\"{label_prefix}}} {}\n",
            snap.ratelimit_rejected
        ));

        out.push_str("# HELP gateway_jwt_validations_total JWT authentication decisions\n");
        out.push_str("# TYPE gateway_jwt_validations_total counter\n");
        out.push_str(&format!(
            "gateway_jwt_validations_total{{status=\"valid\"{label_prefix}}} {}\n",
            snap.jwt_valid
        ));
        out.push_str(&format!(
            "gateway_jwt_validations_total{{status=\"invalid\"{label_prefix}}} {}\n",
            snap.jwt_invalid
        ));
        out.push_str(&format!(
            "gateway_jwt_validations_total{{status=\"expired\"{label_prefix}}} {}\n",
            snap.jwt_expired
        ));
        out.push_str(&format!(
            "gateway_jwt_validations_total{{status=\"missing\"{label_prefix}}} {}\n",
            snap.jwt_missing
        ));

        out.push_str("# HELP gateway_canary_requests_total Canary release routing decisions\n");
        out.push_str("# TYPE gateway_canary_requests_total counter\n");
        out.push_str(&format!(
            "gateway_canary_requests_total{{slot=\"baseline\"{label_prefix}}} {}\n",
            snap.canary_baseline
        ));
        out.push_str(&format!(
            "gateway_canary_requests_total{{slot=\"canary\"{label_prefix}}} {}\n",
            snap.canary_canary
        ));

        out.push_str(
            "# HELP gateway_traffic_split_requests_total Traffic split routing decisions\n",
        );
        out.push_str("# TYPE gateway_traffic_split_requests_total counter\n");
        out.push_str(&format!(
            "gateway_traffic_split_requests_total{{branch=\"primary\"{label_prefix}}} {}\n",
            snap.traffic_split_primary
        ));
        out.push_str(&format!(
            "gateway_traffic_split_requests_total{{branch=\"secondary\"{label_prefix}}} {}\n",
            snap.traffic_split_secondary
        ));
    }
    // Every node gauge carries its measurement scope so historical host and
    // container series cannot be accidentally joined across a deployment change.
    let scope = super::sampler::metrics_scope();
    let mut scoped = String::with_capacity(out.len());
    for line in out.lines() {
        if line.starts_with("aurora_node_") && line.contains('{') {
            scoped.push_str(&line.replacen('{', &format!("{{metrics_scope=\"{scope}\","), 1));
        } else {
            scoped.push_str(line);
        }
        scoped.push('\n');
    }
    scoped
}
