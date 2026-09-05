-- Bảng lưu trữ chuỗi số liệu telemetry lịch sử của các node (Rollup 1 phút/điểm)
-- Giữ lại lịch sử 7 ngày, phục vụ tra cứu mà không làm phình cơ sở dữ liệu.
CREATE TABLE IF NOT EXISTS node_metrics_history (
    node_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    cpu_usage REAL NOT NULL,
    memory_usage REAL NOT NULL,
    active_connections INTEGER NOT NULL,
    requests_per_second REAL NOT NULL,
    PRIMARY KEY (node_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_metrics_history_time ON node_metrics_history (timestamp);
