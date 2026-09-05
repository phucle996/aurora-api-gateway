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
    out
}
