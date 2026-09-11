-- Migration 0001: All table definitions in the system
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

CREATE TABLE IF NOT EXISTS cluster_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL DEFAULT 'localhost',
    ip TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Edge Node',
    status TEXT NOT NULL DEFAULT 'Ready' CHECK(status IN ('Ready', 'Not Ready', 'Draining')),
    version TEXT NOT NULL DEFAULT '0.4.1',
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
    last_applied_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS node_sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('release_applied','reload_completed','drift_detected')),
    release_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Routes table: flat entity with 1:1 upstream binding and 7-phase plugin pipeline

CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '/',
    upstream_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    strip_path BOOLEAN NOT NULL DEFAULT 0,
    websocket BOOLEAN NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    plugins_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- SSL Certificates table: dedicated store decoupled from routes, matched via SNI & mTLS
CREATE TABLE IF NOT EXISTS ssl_certificates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    snis_json TEXT NOT NULL DEFAULT '[]',
    cert_pem TEXT NOT NULL,
    key_pem TEXT NOT NULL,
    mtls_enabled BOOLEAN NOT NULL DEFAULT 0,
    client_ca_pem TEXT NOT NULL DEFAULT '',
    verify_depth INTEGER NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
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

-- Authentication providers
CREATE TABLE IF NOT EXISTS auth_providers (
    id TEXT PRIMARY KEY CHECK(id IN ('local', 'oidc', 'ldap', 'saml')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Alertmanager & Prometheus integration settings singleton record
CREATE TABLE IF NOT EXISTS alertmanager_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    alertmanager_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:9093',
    prometheus_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:9090',
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

-- Extensions catalog and configurations
CREATE TABLE IF NOT EXISTS extensions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('security_engine', 'authentication', 'authorization_security', 'traffic_control', 'request_transformation', 'response_transformation', 'observability', 'resilience_upstream', 'cache_content', 'integration_runtime', 'ai_gateway', 'security', 'auth', 'traffic', 'runtime')),
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0.0',
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(config_json)),
    schema_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(schema_json)),
    is_builtin INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Cluster NodeSpec snapshot releases and head
CREATE TABLE IF NOT EXISTS cluster_spec_releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    digest TEXT NOT NULL UNIQUE,
    spec_yaml TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'system',
    change_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cluster_spec_head (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    release_id INTEGER NOT NULL REFERENCES cluster_spec_releases(id)
);

-- L4 Services (TCP / UDP port listeners with L4 ACL and Upstream / Direct Endpoint forward)
CREATE TABLE IF NOT EXISTS l4_services (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'tcp' CHECK(protocol IN ('tcp', 'udp')),
    listen_port INTEGER NOT NULL CHECK(listen_port >= 1 AND listen_port <= 65535),
    forward_target_type TEXT NOT NULL DEFAULT 'upstream' CHECK(forward_target_type IN ('upstream', 'endpoint')),
    upstream_name TEXT NOT NULL DEFAULT '',
    direct_endpoint TEXT NOT NULL DEFAULT '',
    acl_rules_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acl_rules_json)),
    proxy_timeout TEXT NOT NULL DEFAULT '1h',
    proxy_connect_timeout TEXT NOT NULL DEFAULT '5s',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CONSTRAINT uq_l4_services_listen UNIQUE (protocol, listen_port)
);

