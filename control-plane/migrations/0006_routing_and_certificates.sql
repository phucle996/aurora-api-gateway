-- Migration 0006: Dedicated authority tables for Routing and SSL Certificates
-- Dropping legacy domains table (no backward compatibility needed)

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

CREATE INDEX IF NOT EXISTS idx_routes_host ON routes(host);
CREATE INDEX IF NOT EXISTS idx_routes_upstream ON routes(upstream_name);
CREATE INDEX IF NOT EXISTS idx_routes_enabled ON routes(enabled);

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

CREATE INDEX IF NOT EXISTS idx_ssl_certs_enabled ON ssl_certificates(enabled);

-- Drop legacy domains table and indexes completely
DROP TABLE IF EXISTS domains;
