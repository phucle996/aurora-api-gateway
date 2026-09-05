-- Bảng lưu trữ cấu hình hệ thống và tích hợp (Integrations)
-- Quản lý chế độ thu thập metrics: Standalone (In-Memory Ring Buffer) hoặc External Prometheus
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Khởi tạo cấu hình mặc định là disabled (tắt thu thập metrics cho đến khi người dùng kích hoạt)
INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('metrics_mode', 'disabled'),
    ('prometheus_url', 'http://127.0.0.1:9090'),
    ('prometheus_job', 'aurora-waf-nodes');

