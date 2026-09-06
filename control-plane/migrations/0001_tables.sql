-- Migration 0001: All table definitions in the system
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL CHECK(version > 0),
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
    description TEXT NOT NULL,
    rule_group TEXT NOT NULL CHECK(rule_group IN ('custom','sqli','xss','traversal','bot','endpoint','authentication')),
    action TEXT NOT NULL CHECK(action IN ('allow','log','block')),
    severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
    score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 1000),
    priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 1000000),
    path TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rule_revisions (
    rule_id INTEGER NOT NULL REFERENCES rules(id),
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rule_group TEXT NOT NULL,
    action TEXT NOT NULL,
    severity TEXT NOT NULL,
    score INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    path TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    PRIMARY KEY(rule_id, version)
);

CREATE TABLE rule_creates (
    request_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    rule_id INTEGER NOT NULL REFERENCES rules(id)
);

CREATE TABLE ruleset_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_key TEXT NOT NULL UNIQUE,
    payload BLOB NOT NULL DEFAULT X'',
    digest TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK(state IN ('pending','ready','rejected')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE release_rules (
    release_id INTEGER NOT NULL REFERENCES ruleset_releases(id),
    rule_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY(release_id, rule_id),
    FOREIGN KEY(rule_id, version) REFERENCES rule_revisions(rule_id, version)
);

CREATE TABLE node_activation (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    release_id INTEGER NOT NULL REFERENCES ruleset_releases(id),
    phase TEXT NOT NULL CHECK(phase IN ('pending','reload_requested','rejected')),
    previous_payload BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rule_definitions (
    rule_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    logic_mode TEXT NOT NULL CHECK(logic_mode IN ('all','any')),
    conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
    source_ip TEXT NOT NULL,
    host_domain TEXT NOT NULL,
    path_prefix TEXT NOT NULL,
    http_method TEXT NOT NULL,
    response_code INTEGER,
    custom_response TEXT NOT NULL CHECK(length(custom_response)<=512),
    log_event INTEGER NOT NULL CHECK(log_event IN (0,1)),
    add_to_reputation INTEGER NOT NULL CHECK(add_to_reputation IN (0,1)),
    runtime_ready INTEGER NOT NULL CHECK(runtime_ready IN (0,1)),
    runtime_issues TEXT NOT NULL CHECK(json_valid(runtime_issues)),
    PRIMARY KEY(rule_id,version),
    FOREIGN KEY(rule_id,version) REFERENCES rule_revisions(rule_id,version)
);

CREATE TABLE definition_creates (
    request_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    rule_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    FOREIGN KEY(rule_id,version) REFERENCES rule_definitions(rule_id,version)
);

CREATE TABLE definition_updates (
    request_key TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    rule_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    FOREIGN KEY(rule_id,version) REFERENCES rule_definitions(rule_id,version)
);

CREATE TABLE rule_deletions (
    rule_id INTEGER PRIMARY KEY REFERENCES rules(id),
    version INTEGER NOT NULL,
    actor TEXT NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    pending_command TEXT NOT NULL DEFAULT 'none',
    reload_status TEXT NOT NULL DEFAULT 'idle' CHECK(reload_status IN ('idle', 'pending', 'reloading', 'completed')),
    observed_release_id INTEGER,
    runtime_started_at INTEGER NOT NULL DEFAULT 0,
    worker_identity TEXT NOT NULL DEFAULT '',
    metrics_scope TEXT NOT NULL DEFAULT 'unknown',
    last_applied_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS node_metrics_history (
    node_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    cpu_usage REAL NOT NULL,
    memory_usage REAL NOT NULL,
    active_connections INTEGER NOT NULL,
    requests_per_second REAL NOT NULL,
    metrics_scope TEXT NOT NULL DEFAULT 'legacy-host',
    PRIMARY KEY (node_id, timestamp)
);

CREATE TABLE node_sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('release_applied','reload_completed','drift_detected')),
    release_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL CHECK(version>0),
    document TEXT NOT NULL CHECK(json_valid(document)),
    published_version INTEGER,
    status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Published','Disabled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE policy_revisions (
    policy_id INTEGER NOT NULL REFERENCES policies(id),
    version INTEGER NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document)),
    actor TEXT NOT NULL,
    operation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(policy_id,version)
);

CREATE TABLE policy_receipts (
    actor TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result TEXT NOT NULL CHECK(json_valid(result)),
    PRIMARY KEY(actor,request_key)
);

CREATE TABLE policy_cluster_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload BLOB NOT NULL,
    digest TEXT NOT NULL,
    membership TEXT NOT NULL CHECK(json_valid(membership)),
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE policy_cluster_head (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    release_id INTEGER NOT NULL REFERENCES policy_cluster_releases(id)
);

CREATE TABLE policy_node_reports (
    node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id),
    release_id INTEGER NOT NULL REFERENCES policy_cluster_releases(id),
    phase TEXT NOT NULL CHECK(phase IN ('validated','reload_requested','observed','failed')),
    message TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE access_objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('rule','group','dataset')),
    version INTEGER NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document)),
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE access_revisions (
    object_id INTEGER NOT NULL REFERENCES access_objects(id),
    version INTEGER NOT NULL,
    kind TEXT NOT NULL,
    document TEXT NOT NULL,
    deleted INTEGER NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(object_id,version)
);

CREATE TABLE access_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload BLOB NOT NULL,
    digest TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE access_head (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    release_id INTEGER NOT NULL REFERENCES access_releases(id)
);

CREATE TABLE access_receipts (
    actor TEXT NOT NULL,
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result TEXT NOT NULL,
    PRIMARY KEY(actor,request_key)
);

CREATE TABLE access_reports (
    node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    release_id INTEGER NOT NULL REFERENCES access_releases(id),
    phase TEXT NOT NULL,
    message TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE access_events (
    node_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    release_id INTEGER NOT NULL REFERENCES access_releases(id),
    rule_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    action TEXT NOT NULL,
    reputation INTEGER NOT NULL,
    alert INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(node_id,event_key)
);
