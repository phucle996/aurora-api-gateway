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
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_secret TEXT NOT NULL DEFAULT '',
    two_factor_recovery_codes TEXT NOT NULL DEFAULT '[]',
    two_factor_configured_at TEXT NOT NULL DEFAULT '',
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

-- Domains table
CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    root_domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    tls_type TEXT NOT NULL DEFAULT 'Let''s Encrypt' CHECK(tls_type IN ('Let''s Encrypt', 'Custom Cert', 'mTLS', 'Self-signed')),
    tls_expiry TEXT NOT NULL DEFAULT '',
    tls_auto_renew INTEGER NOT NULL DEFAULT 1 CHECK(tls_auto_renew IN (0,1)),
    min_tls_version TEXT NOT NULL DEFAULT 'TLSv1.3' CHECK(min_tls_version IN ('TLSv1.2', 'TLSv1.3')),
    hsts_enabled INTEGER NOT NULL DEFAULT 1 CHECK(hsts_enabled IN (0,1)),
    ocsp_stapling INTEGER NOT NULL DEFAULT 1 CHECK(ocsp_stapling IN (0,1)),
    client_ca_subject TEXT NOT NULL DEFAULT '',
    upstream TEXT NOT NULL,
    upstream_algorithm TEXT NOT NULL DEFAULT 'round_robin' CHECK(upstream_algorithm IN ('round_robin', 'ip_hash', 'least_conn')),
    health_check_path TEXT NOT NULL DEFAULT '/healthz',
    tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Upstreams and release ledger
CREATE TABLE IF NOT EXISTS upstreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    architecture_type TEXT NOT NULL DEFAULT 'Load Balancer' CHECK(architecture_type IN ('Single Server', 'Load Balancer', 'External (FQDN)')),
    algorithm TEXT NOT NULL DEFAULT 'round_robin' CHECK(algorithm IN ('round_robin', 'least_conn', 'ip_hash')),
    servers_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(servers_json)),
    external_fqdn TEXT NOT NULL DEFAULT '',
    sni_override INTEGER NOT NULL DEFAULT 1 CHECK(sni_override IN (0,1)),
    dynamic_dns INTEGER NOT NULL DEFAULT 1 CHECK(dynamic_dns IN (0,1)),
    internal_ssl_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(internal_ssl_json)),
    probes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(probes_json)),
    transport_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(transport_json)),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS upstream_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL UNIQUE,
    digest TEXT NOT NULL,
    config_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS upstream_node_sync (
    node_id TEXT NOT NULL PRIMARY KEY,
    release_id INTEGER NOT NULL,
    phase TEXT NOT NULL DEFAULT 'observed',
    message TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rate limiting rules and metrics
CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    enabled_dimensions TEXT NOT NULL DEFAULT '["ip"]' CHECK(json_valid(enabled_dimensions)),
    dimension_order TEXT NOT NULL DEFAULT '["ip"]' CHECK(json_valid(dimension_order)),
    ip_config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ip_config)),
    header_config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(header_config)),
    path_config TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(path_config)),
    rate_limit INTEGER NOT NULL CHECK(rate_limit > 0),
    rate_unit TEXT NOT NULL DEFAULT '1 minute',
    burst INTEGER NOT NULL DEFAULT 0,
    action_exceeded TEXT NOT NULL DEFAULT 'block_429',
    custom_response INTEGER NOT NULL DEFAULT 1 CHECK(custom_response IN (0,1)),
    response_code INTEGER NOT NULL DEFAULT 429,
    response_body TEXT NOT NULL DEFAULT '',
    log_events INTEGER NOT NULL DEFAULT 1 CHECK(log_events IN (0,1)),
    add_reputation INTEGER NOT NULL DEFAULT 0 CHECK(add_reputation IN (0,1)),
    enable_alert INTEGER NOT NULL DEFAULT 0 CHECK(enable_alert IN (0,1)),
    status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    created_by TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_hourly_metrics (
    hour_bucket TEXT PRIMARY KEY,
    total_hits INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    throttled_count INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms REAL NOT NULL DEFAULT 0.0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_endpoint_metrics (
    hour_bucket TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    rule_name TEXT NOT NULL DEFAULT '',
    request_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    throttled_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(hour_bucket, endpoint, method)
);

-- Authentication providers
CREATE TABLE IF NOT EXISTS auth_providers (
    id TEXT PRIMARY KEY CHECK(id IN ('local', 'oidc', 'ldap', 'saml')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Notification channels and alert rules
CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY CHECK(id IN ('email', 'slack', 'telegram', 'discord', 'webhook', 'pagerduty')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    last_tested_at TEXT NOT NULL DEFAULT '',
    last_test_status TEXT NOT NULL DEFAULT '',
    last_test_message TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Backup settings & history ledger
CREATE TABLE IF NOT EXISTS backup_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    auto_backup_enabled INTEGER NOT NULL DEFAULT 1 CHECK(auto_backup_enabled IN (0, 1)),
    cron_expression TEXT NOT NULL DEFAULT '0 2 * * *',
    s3_enabled INTEGER NOT NULL DEFAULT 0 CHECK(s3_enabled IN (0, 1)),
    s3_endpoint TEXT NOT NULL DEFAULT '',
    s3_bucket TEXT NOT NULL DEFAULT 'aurora-waf-backups',
    s3_region TEXT NOT NULL DEFAULT 'ap-southeast-1',
    s3_access_key TEXT NOT NULL DEFAULT '',
    s3_secret_key TEXT NOT NULL DEFAULT '',
    s3_prefix TEXT NOT NULL DEFAULT 'backups/',
    s3_retention_days INTEGER NOT NULL DEFAULT 30,
    last_backup_at TEXT NOT NULL DEFAULT '',
    last_backup_status TEXT NOT NULL DEFAULT '',
    last_backup_destination TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS backup_history (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    destination TEXT NOT NULL CHECK(destination IN ('local', 's3')),
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Origin observations
CREATE TABLE IF NOT EXISTS origin_observations (
    node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    observed_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    routing_digest TEXT NOT NULL,
    peers_json TEXT NOT NULL
);

-- Node modules and jobs
CREATE TABLE IF NOT EXISTS node_modules (
    node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    checked_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    nginx_version TEXT NOT NULL,
    architecture TEXT NOT NULL,
    modules_json TEXT NOT NULL,
    installable INTEGER NOT NULL,
    error TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed')),
    message TEXT NOT NULL DEFAULT '',
    logs TEXT NOT NULL DEFAULT '',
    requested_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
