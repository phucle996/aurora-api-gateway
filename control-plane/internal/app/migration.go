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
	if version > 10 {
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
	if version < 6 {
		if _, err := tx.ExecContext(ctx, migrations.ClusterNodes); err != nil {
			return fmt.Errorf("cluster nodes schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO cluster_nodes (id, name, hostname, ip, role, status, version, sync_status, join_method, certificate)
			VALUES ('node-local-01', 'node-local-01', 'localhost', '127.0.0.1', 'Edge Node', 'Ready', '0.4.1', 'In Sync', 'Systemd Service', 'mTLS Enrolled')
		`); err != nil {
			return fmt.Errorf("seed local cluster node: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(6)"); err != nil {
			return err
		}
	}
	if version < 7 {
		if _, err := tx.ExecContext(ctx, migrations.SystemSettings); err != nil {
			return fmt.Errorf("system settings schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(7)"); err != nil {
			return err
		}
	}
	if version < 8 {
		if _, err := tx.ExecContext(ctx, migrations.NodeMetricsHistory); err != nil {
			return fmt.Errorf("node metrics history schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(8)"); err != nil {
			return err
		}
	}
	if version < 9 {
		if _, err := tx.ExecContext(ctx, migrations.ClusterNodeCommands); err != nil {
			return fmt.Errorf("cluster node commands schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(9)"); err != nil {
			return err
		}
	}
	if version < 10 {
		if _, err := tx.ExecContext(ctx, migrations.NodeSyncLogs); err != nil {
			return fmt.Errorf("node sync logs schema: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version) VALUES(10)"); err != nil {
			return err
		}
	}
	return tx.Commit()
}
