-- Migration 0011: Backup & Restore configuration and history ledger

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

-- Seed default backup settings singleton record
INSERT OR IGNORE INTO backup_settings (
    id, auto_backup_enabled, cron_expression, s3_enabled, s3_endpoint, s3_bucket, s3_region,
    s3_access_key, s3_secret_key, s3_prefix, s3_retention_days, last_backup_at, last_backup_status, last_backup_destination
) VALUES (
    1, 1, '0 2 * * *', 0, 'https://s3.ap-southeast-1.amazonaws.com', 'aurora-waf-backups', 'ap-southeast-1',
    '', '', 'backups/', 30, strftime('%Y-%m-%dT%H:%M:%fZ','now', '-1 day'), 'success', 'local'
);

-- Seed initial sample history entry
INSERT OR IGNORE INTO backup_history (id, filename, destination, size_bytes, status, error_message, created_at) VALUES
('bk_init_snapshot', 'aurora-waf-backup-initial.db', 'local', 204800, 'success', '', strftime('%Y-%m-%dT%H:%M:%fZ','now', '-1 day'));
