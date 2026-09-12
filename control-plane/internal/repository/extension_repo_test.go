package repository_test

import (
	"context"
	"database/sql"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/migrations"
	_ "modernc.org/sqlite"
)

func setupExtensionTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite in-memory: %v", err)
	}

	if _, err := db.Exec(migrations.Tables); err != nil {
		t.Fatalf("failed to execute migrations: %v", err)
	}
	if _, err := db.Exec(migrations.Seeds); err != nil {
		t.Fatalf("failed to execute seeds: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO extension_instances (id, manifest_key, manifest_version, enabled, config_json)
		VALUES
			('prometheus', 'builtin/prometheus', 1, 1, '{"port":9145,"prometheus":{"enabled":true,"path":"/metrics"}}'),
			('ip-restriction', 'builtin/ip-restriction', 1, 0, '{"whitelist":[],"blacklist":[],"rules":[]}');
	`); err != nil {
		t.Fatalf("failed to seed extension instances: %v", err)
	}

	return db
}

func TestExtensionRepository_List(t *testing.T) {
	db := setupExtensionTestDB(t)
	defer db.Close()

	repo := repository.NewExtensionRepository(db, db)
	ctx := context.Background()

	// 1. List all
	all, err := repo.List(ctx, entity.ListExtensionsQuery{})
	if err != nil {
		t.Fatalf("List all failed: %v", err)
	}
	if len(all) == 0 {
		t.Fatalf("expected seeded extensions, got 0")
	}

	// 2. Filter by status enabled
	enabledExts, err := repo.List(ctx, entity.ListExtensionsQuery{Status: "enabled"})
	if err != nil {
		t.Fatalf("List status enabled failed: %v", err)
	}
	for _, ext := range enabledExts {
		if !ext.Enabled {
			t.Errorf("expected enabled=true, got %v", ext.Enabled)
		}
	}
}

func TestExtensionRepository_GetByID(t *testing.T) {
	db := setupExtensionTestDB(t)
	defer db.Close()

	repo := repository.NewExtensionRepository(db, db)
	ctx := context.Background()

	// Existing extension (prometheus is seeded)
	ext, err := repo.GetByID(ctx, "prometheus")
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if ext.ID != "prometheus" || ext.ManifestKey != "builtin/prometheus" {
		t.Errorf("unexpected extension: %+v", ext)
	}

	// Non-existing
	_, err = repo.GetByID(ctx, "nonexistent-extension")
	if err == nil {
		t.Fatalf("expected error for nonexistent extension, got nil")
	}
}

func TestExtensionRepository_UpdateStatusAndConfig(t *testing.T) {
	db := setupExtensionTestDB(t)
	defer db.Close()

	repo := repository.NewExtensionRepository(db, db)
	ctx := context.Background()

	// Toggle status
	err := repo.UpdateStatus(ctx, entity.UpdateExtensionStatusCommand{
		ID:      "prometheus",
		Enabled: false,
	})
	if err != nil {
		t.Fatalf("UpdateStatus failed: %v", err)
	}

	ext, err := repo.GetByID(ctx, "prometheus")
	if err != nil {
		t.Fatalf("GetByID after update failed: %v", err)
	}
	if ext.Enabled {
		t.Errorf("expected enabled=false, got true")
	}

	// Update config
	newCfg := `{"port":9999}`
	err = repo.UpdateConfig(ctx, entity.UpdateExtensionConfigCommand{
		ID:         "prometheus",
		ConfigJSON: newCfg,
	})
	if err != nil {
		t.Fatalf("UpdateConfig failed: %v", err)
	}

	ext, err = repo.GetByID(ctx, "prometheus")
	if err != nil {
		t.Fatalf("GetByID after config update failed: %v", err)
	}
	if ext.ConfigJSON != newCfg {
		t.Errorf("expected config %s, got %s", newCfg, ext.ConfigJSON)
	}

	// Updating nonexistent should return error
	err = repo.UpdateStatus(ctx, entity.UpdateExtensionStatusCommand{
		ID:      "unknown",
		Enabled: true,
	})
	if err == nil {
		t.Errorf("expected error updating status for unknown extension")
	}
}
