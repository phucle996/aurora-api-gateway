package repository

import (
	"context"
	"database/sql"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type sqliteBackupRepository struct {
	db *sql.DB
}

// NewBackupRepository khởi tạo SQLite repository cho module Backup & Restore.
func NewBackupRepository(db *sql.DB) repo.BackupRepository {
	return &sqliteBackupRepository{db: db}
}

// GetConfig lấy cấu hình backup hiện tại.
func (r *sqliteBackupRepository) GetConfig(ctx context.Context) (*entity.BackupConfig, error) {
	query := `
		SELECT 
			auto_backup_enabled, cron_expression, s3_enabled, s3_endpoint, s3_bucket,
			s3_region, s3_access_key, s3_secret_key, s3_prefix, s3_retention_days,
			last_backup_at, last_backup_status, last_backup_destination, updated_at
		FROM backup_settings
		WHERE id = 1;
	`
	var cfg entity.BackupConfig
	var autoBackupInt, s3EnabledInt int

	err := r.db.QueryRowContext(ctx, query).Scan(
		&autoBackupInt, &cfg.CronExpression, &s3EnabledInt, &cfg.S3Endpoint, &cfg.S3Bucket,
		&cfg.S3Region, &cfg.S3AccessKey, &cfg.S3SecretKey, &cfg.S3Prefix, &cfg.S3RetentionDays,
		&cfg.LastBackupAt, &cfg.LastBackupStatus, &cfg.LastBackupDestination, &cfg.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("truy vấn backup_settings thất bại: %w", err)
	}

	cfg.AutoBackupEnabled = autoBackupInt == 1
	cfg.S3Enabled = s3EnabledInt == 1
	return &cfg, nil
}

// UpdateConfig cập nhật cấu hình backup, cron expression và thông số S3.
func (r *sqliteBackupRepository) UpdateConfig(ctx context.Context, cfg entity.BackupConfig) error {
	autoBackupInt := 0
	if cfg.AutoBackupEnabled {
		autoBackupInt = 1
	}
	s3EnabledInt := 0
	if cfg.S3Enabled {
		s3EnabledInt = 1
	}

	query := `
		UPDATE backup_settings
		SET 
			auto_backup_enabled = ?,
			cron_expression = ?,
			s3_enabled = ?,
			s3_endpoint = ?,
			s3_bucket = ?,
			s3_region = ?,
			s3_access_key = ?,
			s3_secret_key = ?,
			s3_prefix = ?,
			s3_retention_days = ?,
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = 1;
	`
	_, err := r.db.ExecContext(
		ctx, query,
		autoBackupInt, cfg.CronExpression, s3EnabledInt, cfg.S3Endpoint, cfg.S3Bucket,
		cfg.S3Region, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Prefix, cfg.S3RetentionDays,
	)
	if err != nil {
		return fmt.Errorf("cập nhật backup_settings thất bại: %w", err)
	}
	return nil
}

// RecordHistory lưu bản ghi lịch sử sao lưu.
func (r *sqliteBackupRepository) RecordHistory(ctx context.Context, item entity.BackupHistoryItem) error {
	query := `
		INSERT INTO backup_history (id, filename, destination, size_bytes, status, error_message, created_at)
		VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
	`
	_, err := r.db.ExecContext(ctx, query, item.ID, item.Filename, item.Destination, item.SizeBytes, item.Status, item.ErrorMessage)
	return err
}

// ListHistory lấy danh sách các bản ghi lịch sử backup gần nhất qua CTE.
func (r *sqliteBackupRepository) ListHistory(ctx context.Context, limit int) ([]entity.BackupHistoryItem, error) {
	if limit <= 0 {
		limit = 20
	}

	const query = `
		WITH history_cte AS (
			SELECT id, filename, destination, size_bytes, status, error_message, created_at
			FROM backup_history
			ORDER BY created_at DESC
			LIMIT ?
		)
		SELECT id, filename, destination, size_bytes, status, error_message, created_at
		FROM history_cte;
	`
	rows, err := r.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("truy vấn backup_history thất bại: %w", err)
	}
	defer rows.Close()

	var list []entity.BackupHistoryItem
	for rows.Next() {
		var item entity.BackupHistoryItem
		if err := rows.Scan(
			&item.ID, &item.Filename, &item.Destination, &item.SizeBytes,
			&item.Status, &item.ErrorMessage, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("đọc bản ghi backup_history thất bại: %w", err)
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

// UpdateLastBackup cập nhật trạng thái của lần sao lưu gần nhất.
func (r *sqliteBackupRepository) UpdateLastBackup(ctx context.Context, destination string, status string) error {
	query := `
		UPDATE backup_settings
		SET 
			last_backup_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
			last_backup_destination = ?,
			last_backup_status = ?
		WHERE id = 1;
	`
	_, err := r.db.ExecContext(ctx, query, destination, status)
	return err
}
