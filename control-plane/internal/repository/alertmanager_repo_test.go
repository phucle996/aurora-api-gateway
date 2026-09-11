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

func setupAlertmanagerTestDB(t *testing.T) *sql.DB {
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

	return db
}

func TestAlertmanagerRepository_GetAndUpdate(t *testing.T) {
	db := setupAlertmanagerTestDB(t)
	defer db.Close()

	repo := repository.NewAlertmanagerRepository(db)
	ctx := context.Background()

	// 1. Kiểm tra cấu hình mặc định đã được seed
	cfg, err := repo.GetSettings(ctx)
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}
	if !cfg.Enabled {
		t.Errorf("expected seeded enabled = true, got false")
	}
	if cfg.AlertmanagerURL != "http://127.0.0.1:9093" {
		t.Errorf("expected default alertmanager_url, got %s", cfg.AlertmanagerURL)
	}
	if cfg.PrometheusURL != "http://127.0.0.1:9090" {
		t.Errorf("expected default prometheus_url, got %s", cfg.PrometheusURL)
	}

	// 2. Cập nhật cấu hình mới
	updated := entity.AlertmanagerSettings{
		Enabled:         false,
		AlertmanagerURL: "http://alertmanager.monitoring.svc:9093",
		PrometheusURL:   "http://prometheus.monitoring.svc:9090",
	}
	if err := repo.UpdateSettings(ctx, updated); err != nil {
		t.Fatalf("UpdateSettings failed: %v", err)
	}

	// 3. Đọc lại và kiểm tra tính bền vững
	after, err := repo.GetSettings(ctx)
	if err != nil {
		t.Fatalf("GetSettings after update failed: %v", err)
	}
	if after.Enabled != false {
		t.Errorf("expected enabled = false, got true")
	}
	if after.AlertmanagerURL != updated.AlertmanagerURL {
		t.Errorf("expected %s, got %s", updated.AlertmanagerURL, after.AlertmanagerURL)
	}
	if after.PrometheusURL != updated.PrometheusURL {
		t.Errorf("expected %s, got %s", updated.PrometheusURL, after.PrometheusURL)
	}
}
