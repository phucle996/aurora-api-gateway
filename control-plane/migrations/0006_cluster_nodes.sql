-- Bảng lưu trữ danh sách các NGINX Data Plane node đã đăng ký vào cluster
CREATE TABLE cluster_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL DEFAULT 'localhost',
    ip TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Edge Node',
    status TEXT NOT NULL DEFAULT 'Ready' CHECK(status IN ('Ready', 'Not Ready', 'Draining')),
    version TEXT NOT NULL DEFAULT '0.4.1',
    active_release_id INTEGER REFERENCES ruleset_releases(id),
    sync_status TEXT NOT NULL DEFAULT 'In Sync' CHECK(sync_status IN ('In Sync', 'Drift', 'Syncing')),
    join_method TEXT NOT NULL DEFAULT 'Systemd Service',
    certificate TEXT NOT NULL DEFAULT 'mTLS Enrolled',
    last_heartbeat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_cluster_nodes_status ON cluster_nodes(status, sync_status);
