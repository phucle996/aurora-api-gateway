DROP TABLE IF EXISTS extensions;

CREATE TABLE extension_instances (
    id TEXT PRIMARY KEY,
    manifest_key TEXT NOT NULL,
    manifest_version INTEGER NOT NULL CHECK(manifest_version > 0),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    config_json TEXT NOT NULL CHECK(json_valid(config_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(manifest_key, manifest_version)
);
