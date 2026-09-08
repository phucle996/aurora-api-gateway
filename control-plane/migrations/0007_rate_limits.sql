-- Migration 0007: Rate limit rules table definitions and indexes

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

CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_name ON rate_limit_rules(name);
CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_status ON rate_limit_rules(status);
