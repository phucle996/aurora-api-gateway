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
	if _, err := tx.ExecContext(ctx, migrations.Bootstrap); err != nil {
		return fmt.Errorf("bootstrap schema: %w", err)
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return err
	}
	if version > 5 {
		return fmt.Errorf("unsupported database schema version %d", version)
	}
	if version == 0 {
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations (version) VALUES (1)"); err != nil {
			return err
		}
	}
	if version < 2 {
		if _, err := tx.ExecContext(ctx, migrations.Rules); err != nil {
			return fmt.Errorf("rules schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(2)"); err != nil {
			return err
		}
	}
	if version < 3 {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM node_activation").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return fmt.Errorf("v2 activation journal requires operator recovery before upgrade")
		}
		if _, err := tx.ExecContext(ctx, migrations.ActivationJournal); err != nil {
			return fmt.Errorf("activation journal schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(3)"); err != nil {
			return err
		}
	}
	if version < 4 {
		if _, err := tx.ExecContext(ctx, migrations.RuleDefinitions); err != nil {
			return fmt.Errorf("rule definitions schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(4)"); err != nil {
			return err
		}
	}
	if version < 5 {
		if _, err := tx.ExecContext(ctx, migrations.Users); err != nil {
			return fmt.Errorf("users schema: %w", err)
		}
		saltHex := "7e88c0a969f6e52c"
		saltBytes, _ := hex.DecodeString(saltHex)
		passHash := service.HashPasswordArgon2("admin", saltBytes)
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)",
			"usr_admin_01", "admin", passHash, saltHex, "admin"); err != nil {
			return fmt.Errorf("seed admin user: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(5)"); err != nil {
			return err
		}
	}
	return tx.Commit()
}
