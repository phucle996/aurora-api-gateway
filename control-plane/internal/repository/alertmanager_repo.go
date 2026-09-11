package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type alertmanagerRepo struct {
	db *sql.DB
}

// NewAlertmanagerRepository khởi tạo repository quản lý cấu hình Alertmanager.
func NewAlertmanagerRepository(db *sql.DB) repo.AlertmanagerRepository {
	return &alertmanagerRepo{db: db}
}

func (r *alertmanagerRepo) GetSettings(ctx context.Context) (*entity.AlertmanagerSettings, error) {
	const query = `
		WITH current_settings AS (
			SELECT enabled, alertmanager_url, prometheus_url, updated_at
			FROM alertmanager_settings
			WHERE id = 1
		)
		SELECT enabled, alertmanager_url, prometheus_url, updated_at
		FROM current_settings;
	`

	var s entity.AlertmanagerSettings
	var enabledInt int
	err := r.db.QueryRowContext(ctx, query).Scan(
		&enabledInt,
		&s.AlertmanagerURL,
		&s.PrometheusURL,
		&s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// Giá trị mặc định nếu chưa có record
			return &entity.AlertmanagerSettings{
				Enabled:         true,
				AlertmanagerURL: "http://127.0.0.1:9093",
				PrometheusURL:   "http://127.0.0.1:9090",
				UpdatedAt:       time.Now().Format(time.RFC3339),
			}, nil
		}
		return nil, fmt.Errorf("truy vấn alertmanager_settings thất bại: %w", err)
	}

	s.Enabled = enabledInt == 1
	return &s, nil
}

func (r *alertmanagerRepo) UpdateSettings(ctx context.Context, settings entity.AlertmanagerSettings) error {
	const query = `
		INSERT INTO alertmanager_settings (id, enabled, alertmanager_url, prometheus_url, updated_at)
		VALUES (1, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
		ON CONFLICT(id) DO UPDATE SET
			enabled = excluded.enabled,
			alertmanager_url = excluded.alertmanager_url,
			prometheus_url = excluded.prometheus_url,
			updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'));
	`

	enabledInt := 0
	if settings.Enabled {
		enabledInt = 1
	}

	_, err := r.db.ExecContext(ctx, query,
		enabledInt,
		settings.AlertmanagerURL,
		settings.PrometheusURL,
	)
	if err != nil {
		return fmt.Errorf("cập nhật alertmanager_settings thất bại: %w", err)
	}

	return nil
}
