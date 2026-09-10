package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

type sqliteAnalyticsRepository struct {
	db *sql.DB
}

// NewAnalyticsRepository khởi tạo repository quản lý cấu hình Telemetry / Analytics qua SQLite.
func NewAnalyticsRepository(db *sql.DB) repo.AnalyticsRepository {
	return &sqliteAnalyticsRepository{db: db}
}

// NewSettingsRepository là alias chuyển tiếp sang NewAnalyticsRepository để tương thích ngược.
func NewSettingsRepository(db *sql.DB) repo.SettingsRepository {
	return NewAnalyticsRepository(db)
}

// GetMetricsConfig lấy cấu hình tích hợp metrics hiện tại từ bảng system_settings.
func (r *sqliteAnalyticsRepository) GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	query := `
	SELECT key, value, updated_at
	FROM system_settings
	WHERE key LIKE 'metrics_%' OR key LIKE 'prometheus_%';`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("truy vấn cấu hình telemetry thất bại: %w", err)
	}
	defer rows.Close()

	cfg := &entity.MetricsIntegrationConfig{}
	var count int

	for rows.Next() {
		var key, val, updatedAt string
		if err := rows.Scan(&key, &val, &updatedAt); err != nil {
			return nil, taxonomy.ErrSettingsStorage
		}
		count++
		cfg.UpdatedAt = updatedAt
		switch key {
		case "metrics_mode":
			cfg.Mode = val
		case "prometheus_url":
			cfg.PrometheusURL = val
		case "prometheus_job":
			cfg.PrometheusJob = val
		case "metrics_auth_type":
			cfg.AuthType = val
		case "metrics_auth_token":
			cfg.AuthToken = val
		case "metrics_auth_username":
			cfg.AuthUsername = val
		case "metrics_auth_password":
			cfg.AuthPassword = val
		case "metrics_custom_headers":
			_ = json.Unmarshal([]byte(val), &cfg.CustomHeaders)
		case "metrics_tls_enabled":
			cfg.TLSEnabled = val == "true"
		case "metrics_tls_insecure_skip":
			cfg.InsecureSkip = val == "true"
		case "metrics_tls_ca_cert":
			cfg.CACertPEM = val
		case "metrics_tls_client_cert":
			cfg.ClientCertPEM = val
		case "metrics_tls_client_key":
			cfg.ClientKeyPEM = val
		}
	}
	if err := rows.Err(); err != nil {
		return nil, taxonomy.ErrSettingsStorage
	}
	if count == 0 {
		return nil, taxonomy.ErrSettingsStorage
	}
	return cfg, nil
}

// SaveMetricsConfig lưu cấu hình tích hợp metrics vào bảng system_settings.
func (r *sqliteAnalyticsRepository) SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
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

	headersJSON := "{}"
	if cfg.CustomHeaders != nil {
		if b, err := json.Marshal(cfg.CustomHeaders); err == nil {
			headersJSON = string(b)
		}
	}

	params := [][2]string{
		{"metrics_mode", cfg.Mode},
		{"prometheus_url", cfg.PrometheusURL},
		{"prometheus_job", cfg.PrometheusJob},
		{"metrics_auth_type", cfg.AuthType},
		{"metrics_auth_token", cfg.AuthToken},
		{"metrics_auth_username", cfg.AuthUsername},
		{"metrics_auth_password", cfg.AuthPassword},
		{"metrics_custom_headers", headersJSON},
		{"metrics_tls_enabled", fmt.Sprintf("%t", cfg.TLSEnabled)},
		{"metrics_tls_insecure_skip", fmt.Sprintf("%t", cfg.InsecureSkip)},
		{"metrics_tls_ca_cert", cfg.CACertPEM},
		{"metrics_tls_client_cert", cfg.ClientCertPEM},
		{"metrics_tls_client_key", cfg.ClientKeyPEM},
	}

	for _, p := range params {
		if _, err := tx.ExecContext(ctx, query, p[0], p[1]); err != nil {
			return fmt.Errorf("lưu cấu hình telemetry %s thất bại: %w", p[0], err)
		}
	}

	return tx.Commit()
}
