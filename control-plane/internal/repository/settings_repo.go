package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"database/sql"
	"fmt"
)

type sqliteSettingsRepository struct {
	db *sql.DB
}

// NewSettingsRepository khởi tạo repository quản lý cấu hình hệ thống qua SQLite.
func NewSettingsRepository(db *sql.DB) repo.SettingsRepository {
	return &sqliteSettingsRepository{db: db}
}

// GetMetricsConfig lấy cấu hình tích hợp metrics hiện tại từ bảng system_settings.
func (r *sqliteSettingsRepository) GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	query := `
	SELECT key, value, updated_at
	FROM system_settings
	WHERE key IN ('metrics_mode', 'prometheus_url', 'prometheus_job');`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("truy vấn system_settings thất bại: %w", err)
	}
	defer rows.Close()

	// Cấu hình mặc định nếu bảng chưa có bản ghi
	cfg := &entity.MetricsIntegrationConfig{
		Mode:          "disabled",
		PrometheusURL: "http://127.0.0.1:9090",
		PrometheusJob: "aurora-waf-nodes",
	}

	for rows.Next() {
		var key, val, updatedAt string
		if err := rows.Scan(&key, &val, &updatedAt); err != nil {
			return nil, taxonomy.ErrSettingsStorage
		}
		cfg.UpdatedAt = updatedAt
		switch key {
		case "metrics_mode":
			cfg.Mode = val
		case "prometheus_url":
			cfg.PrometheusURL = val
		case "prometheus_job":
			cfg.PrometheusJob = val
		}
	}
	if err := rows.Err(); err != nil {
		return nil, taxonomy.ErrSettingsStorage
	}
	return cfg, nil
}

// SaveMetricsConfig lưu cấu hình tích hợp metrics vào bảng system_settings.
func (r *sqliteSettingsRepository) SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	query := `
	INSERT INTO system_settings (key, value, updated_at)
	VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	ON CONFLICT(key) DO UPDATE SET
		value = excluded.value,
		updated_at = excluded.updated_at;`

	if _, err := tx.ExecContext(ctx, query, "metrics_mode", cfg.Mode); err != nil {
		return fmt.Errorf("lưu metrics_mode thất bại: %w", err)
	}
	if _, err := tx.ExecContext(ctx, query, "prometheus_url", cfg.PrometheusURL); err != nil {
		return fmt.Errorf("lưu prometheus_url thất bại: %w", err)
	}
	if _, err := tx.ExecContext(ctx, query, "prometheus_job", cfg.PrometheusJob); err != nil {
		return fmt.Errorf("lưu prometheus_job thất bại: %w", err)
	}

	return tx.Commit()
}
