package app

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"

	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/migrations"
)

func runMigrations(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`); err != nil {
		return fmt.Errorf("bootstrap schema: %w", err)
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return err
	}
	if version > 4 {
		return fmt.Errorf("unsupported database schema version %d", version)
	}
	if version < 1 {
		if _, err := tx.ExecContext(ctx, migrations.Tables); err != nil {
			return fmt.Errorf("tables schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations (version) VALUES (1)"); err != nil {
			return err
		}
	}
	if version < 2 {
		if _, err := tx.ExecContext(ctx, migrations.Indexes); err != nil {
			return fmt.Errorf("indexes schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(2)"); err != nil {
			return err
		}
	}
	if version < 3 {
		if _, err := tx.ExecContext(ctx, migrations.Triggers); err != nil {
			return fmt.Errorf("triggers schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(3)"); err != nil {
			return err
		}
	}
	if version < 4 {
		if _, err := tx.ExecContext(ctx, migrations.Seeds); err != nil {
			return fmt.Errorf("seeds: %w", err)
		}
		saltHex := "7e88c0a969f6e52c"
		saltBytes, _ := hex.DecodeString(saltHex)
		passHash := service.HashPasswordArgon2("admin", saltBytes)
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)",
			"usr_admin_01", "admin", passHash, saltHex, "admin"); err != nil {
			return fmt.Errorf("seed admin user: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(4)"); err != nil {
			return err
		}
	}

	// Đảm bảo các bảng module store luôn tồn tại trên các database đã khởi tạo từ trước
	if _, err := tx.ExecContext(ctx, `
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

CREATE TABLE IF NOT EXISTS module_desired_state (
    name TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS module_job_active ON module_jobs(node_id) WHERE state IN ('pending','running');
CREATE INDEX IF NOT EXISTS module_job_latest ON module_jobs(node_id,id DESC);
`); err != nil {
		return fmt.Errorf("ensure module store schema: %w", err)
	}

	return tx.Commit()
}
