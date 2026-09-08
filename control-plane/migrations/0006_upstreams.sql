-- Migration 0006: Upstream pools management table definitions and release ledger

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

CREATE INDEX IF NOT EXISTS idx_upstreams_name ON upstreams(name);
CREATE INDEX IF NOT EXISTS idx_upstreams_type ON upstreams(architecture_type);
CREATE INDEX IF NOT EXISTS idx_upstreams_version ON upstreams(version);

