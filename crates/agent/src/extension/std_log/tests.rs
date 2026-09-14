use super::config::{StdLogConfig, StdLogFormat, StdLogLevel};
use super::worker::{LogStreamWriter, spawn_std_log_worker_inner};
use crate::logs::GatewayLogEntry;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct MockStreamWriter {
    stdout_lines: Arc<Mutex<Vec<String>>>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
}

impl LogStreamWriter for MockStreamWriter {
    fn write_stdout(&self, line: &str) {
        self.stdout_lines.lock().unwrap().push(line.to_string());
    }

    fn write_stderr(&self, line: &str) {
        self.stderr_lines.lock().unwrap().push(line.to_string());
    }
}

#[tokio::test]
async fn test_std_log_worker_split_streams_routing() {
    let stdout_lines = Arc::new(Mutex::new(Vec::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::new()));

    let mock_writer = Arc::new(MockStreamWriter {
        stdout_lines: stdout_lines.clone(),
        stderr_lines: stderr_lines.clone(),
    });

    let config = StdLogConfig {
        enabled: true,
        format: StdLogFormat::Json,
        split_streams: true,
        log_level: StdLogLevel::All,
        include_waf_details: true,
    };

    let mut handle = spawn_std_log_worker_inner(config, None, mock_writer);
    let sender = handle.sender();

    // 1. Send normal 200 request -> should route to stdout
    let _ = sender
        .send(GatewayLogEntry {
            status: Some(200),
            uri: Some("/ok".to_string()),
            ..Default::default()
        })
        .await;

    // 2. Send 404 client error -> should route to stdout (split_streams only routes ERROR to stderr)
    let _ = sender
        .send(GatewayLogEntry {
            status: Some(404),
            uri: Some("/missing".to_string()),
            ..Default::default()
        })
        .await;

    // 3. Send 500 server error -> should route to stderr
    let _ = sender
        .send(GatewayLogEntry {
            status: Some(500),
            uri: Some("/error".to_string()),
            ..Default::default()
        })
        .await;

    // 4. Send WAF 403 Block -> should route to stderr
    let _ = sender
        .send(GatewayLogEntry {
            status: Some(403),
            uri: Some("/sqli".to_string()),
            waf_action: Some("block".to_string()),
            waf_rule_id: Some("rule-100".to_string()),
            ..Default::default()
        })
        .await;

    handle.shutdown(Duration::from_secs(2)).await;

    assert!(handle.is_terminated());

    let out = stdout_lines.lock().unwrap();
    let err = stderr_lines.lock().unwrap();

    assert_eq!(out.len(), 2, "expected 2 records in stdout");
    assert!(out[0].contains("\"status\":200"));
    assert!(out[1].contains("\"status\":404"));

    assert_eq!(err.len(), 2, "expected 2 records in stderr");
    assert!(err[0].contains("\"status\":500"));
    assert!(err[1].contains("\"status\":403"));
    assert!(err[1].contains("\"waf_action\":\"block\""));
}

#[tokio::test]
async fn test_std_log_worker_no_split_streams_all_to_stdout() {
    let stdout_lines = Arc::new(Mutex::new(Vec::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::new()));

    let mock_writer = Arc::new(MockStreamWriter {
        stdout_lines: stdout_lines.clone(),
        stderr_lines: stderr_lines.clone(),
    });

    let config = StdLogConfig {
        enabled: true,
        format: StdLogFormat::Text,
        split_streams: false,
        log_level: StdLogLevel::All,
        include_waf_details: true,
    };

    let mut handle = spawn_std_log_worker_inner(config, None, mock_writer);
    let sender = handle.sender();

    let _ = sender
        .send(GatewayLogEntry {
            status: Some(500),
            uri: Some("/error".to_string()),
            ..Default::default()
        })
        .await;

    handle.shutdown(Duration::from_secs(2)).await;

    assert!(handle.is_terminated());

    let out = stdout_lines.lock().unwrap();
    let err = stderr_lines.lock().unwrap();

    assert_eq!(
        out.len(),
        1,
        "expected all records in stdout when split_streams=false"
    );
    assert_eq!(err.len(), 0, "expected 0 records in stderr");
    assert!(out[0].contains("[ERROR] - /error 500"));
}

#[tokio::test]
async fn test_std_log_worker_shutdown_drains_all() {
    let stdout_lines = Arc::new(Mutex::new(Vec::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::new()));

    let mock_writer = Arc::new(MockStreamWriter {
        stdout_lines: stdout_lines.clone(),
        stderr_lines: stderr_lines.clone(),
    });

    let config = StdLogConfig {
        enabled: true,
        format: StdLogFormat::Json,
        split_streams: true,
        log_level: StdLogLevel::Info,
        include_waf_details: true,
    };

    let mut handle = spawn_std_log_worker_inner(config, None, mock_writer);
    let sender = handle.sender();

    for i in 0..10 {
        let _ = sender
            .send(GatewayLogEntry {
                status: Some(200),
                uri: Some(format!("/batch-{}", i)),
                ..Default::default()
            })
            .await;
    }

    handle.shutdown(Duration::from_secs(2)).await;

    assert!(handle.is_terminated());
    let out = stdout_lines.lock().unwrap();
    assert_eq!(out.len(), 10, "all 10 records must be drained on shutdown");
}
