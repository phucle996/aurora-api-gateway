-- Bảng lưu trữ cấu hình hệ thống và tích hợp (Integrations)
-- Quản lý chế độ thu thập metrics: Standalone (In-Memory Ring Buffer) hoặc External Prometheus
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Khởi tạo cấu hình mặc định là chế độ standalone để chạy out-of-the-box cho môi trường Lab/Dev
INSERT OR IGNORE INTO system_settings (key, value) VALUES
    ('metrics_mode', 'standalone'),
    ('prometheus_url', 'http://127.0.0.1:9090'),
    ('prometheus_job', 'aurora-waf-nodes');
