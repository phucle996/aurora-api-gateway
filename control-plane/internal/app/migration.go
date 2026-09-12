package app

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"

	"aurora-waf.local/control-plane/internal/extensionmanifest"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/migrations"
)

func runMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = OFF;"); err != nil {
		return err
	}
	defer func() {
		_, _ = db.ExecContext(ctx, "PRAGMA foreign_keys = ON;")
	}()

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

	// Installed manifests are immutable release assets while instances are
	// durable configuration. Insert only absent instances so a newly shipped
	// implementation is available on existing v4 databases without replacing
	// an operator's configuration.
	manifests, err := extensionmanifest.All()
	if err != nil {
		return err
	}
	for _, manifest := range manifests {
		configJSON, err := extensionmanifest.ValidateConfig(manifest, string(manifest.DefaultConfig))
		if err != nil {
			return fmt.Errorf("validate default config for %s: %w", manifest.Key, err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO extension_instances (id, manifest_key, manifest_version, enabled, config_json)
			VALUES (?, ?, ?, 0, ?)
		`, manifest.ID, manifest.Key, manifest.Version, configJSON); err != nil {
			return fmt.Errorf("seed extension instance %s: %w", manifest.Key, err)
		}
	}

	return tx.Commit()
}
