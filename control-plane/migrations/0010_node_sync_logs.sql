-- Bảng lưu vết các sự kiện sync thực tế của node (release applied, drift, reload)
CREATE TABLE IF NOT EXISTS node_sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('release_applied', 'reload_completed', 'drift_detected')),
    release_id INTEGER REFERENCES ruleset_releases(id),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_node_sync_logs_node_id ON node_sync_logs(node_id, id DESC);
