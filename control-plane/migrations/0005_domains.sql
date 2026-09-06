-- Migration 0005: Domains management table definitions and indexes

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

CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_tls_type ON domains(tls_type);
