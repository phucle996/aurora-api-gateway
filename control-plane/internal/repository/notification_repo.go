package repository

import (
	"context"
	"database/sql"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type sqliteNotificationRepository struct {
	db *sql.DB
}

// NewNotificationRepository khởi tạo repository cho quản lý thông báo.
func NewNotificationRepository(db *sql.DB) repo.NotificationRepository {
	return &sqliteNotificationRepository{db: db}
}

// GetOverview trả về danh sách toàn bộ kênh thông báo và quy tắc kích hoạt.
func (r *sqliteNotificationRepository) GetOverview(ctx context.Context) (*entity.NotificationOverview, error) {
	const channelsQuery = `
		WITH channels_cte AS (
			SELECT id, name, description, enabled, config_json, last_tested_at, last_test_status, last_test_message, updated_at
			FROM notification_channels
			ORDER BY CASE id 
				WHEN 'email' THEN 1 
				WHEN 'slack' THEN 2 
				WHEN 'telegram' THEN 3 
				WHEN 'discord' THEN 4 
				WHEN 'webhook' THEN 5 
				WHEN 'pagerduty' THEN 6 
				ELSE 7 
			END
		)
		SELECT id, name, description, enabled, config_json, last_tested_at, last_test_status, last_test_message, updated_at
		FROM channels_cte;
	`

	rows, err := r.db.QueryContext(ctx, channelsQuery)
	if err != nil {
		return nil, fmt.Errorf("truy vấn notification_channels thất bại: %w", err)
	}
	defer rows.Close()

	var channels []entity.NotificationChannelItem
	for rows.Next() {
		var item entity.NotificationChannelItem
		var enabledInt int
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Description, &enabledInt,
			&item.ConfigJSON, &item.LastTestedAt, &item.LastTestStatus, &item.LastTestMessage, &item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("đọc bản ghi notification_channel thất bại: %w", err)
		}
		item.Enabled = enabledInt == 1
		channels = append(channels, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	const rulesQuery = `
		WITH rules_cte AS (
			SELECT id, name, description, severity, enabled, updated_at
			FROM notification_rules
			ORDER BY CASE severity 
				WHEN 'critical' THEN 1 
				WHEN 'high' THEN 2 
				WHEN 'medium' THEN 3 
				WHEN 'low' THEN 4 
				ELSE 5 
			END
		)
		SELECT id, name, description, severity, enabled, updated_at
		FROM rules_cte;
	`

	rRows, err := r.db.QueryContext(ctx, rulesQuery)
	if err != nil {
		return nil, fmt.Errorf("truy vấn notification_rules thất bại: %w", err)
	}
	defer rRows.Close()

	var rules []entity.NotificationRuleItem
	for rRows.Next() {
		var rItem entity.NotificationRuleItem
		var enabledInt int
		if err := rRows.Scan(&rItem.ID, &rItem.Name, &rItem.Description, &rItem.Severity, &enabledInt, &rItem.UpdatedAt); err != nil {
			return nil, fmt.Errorf("đọc bản ghi notification_rule thất bại: %w", err)
		}
		rItem.Enabled = enabledInt == 1
		rules = append(rules, rItem)
	}
	if err := rRows.Err(); err != nil {
		return nil, err
	}

	return &entity.NotificationOverview{
		Channels: channels,
		Rules:    rules,
	}, nil
}

// GetChannelByID lấy thông tin của một kênh thông báo.
func (r *sqliteNotificationRepository) GetChannelByID(ctx context.Context, id string) (*entity.NotificationChannelItem, error) {
	query := `
		SELECT id, name, description, enabled, config_json, last_tested_at, last_test_status, last_test_message, updated_at
		FROM notification_channels
		WHERE id = ?;
	`
	var item entity.NotificationChannelItem
	var enabledInt int
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID, &item.Name, &item.Description, &enabledInt,
		&item.ConfigJSON, &item.LastTestedAt, &item.LastTestStatus, &item.LastTestMessage, &item.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("không tìm thấy kênh thông báo: %s", id)
	}
	if err != nil {
		return nil, err
	}
	item.Enabled = enabledInt == 1
	return &item, nil
}

// UpdateChannel cập nhật trạng thái bật/tắt và cấu hình JSON của kênh.
func (r *sqliteNotificationRepository) UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	query := `
		UPDATE notification_channels
		SET enabled = ?, config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`
	res, err := r.db.ExecContext(ctx, query, enabledInt, configJSON, id)
	if err != nil {
		return fmt.Errorf("cập nhật notification_channels thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("không tìm thấy kênh thông báo: %s", id)
	}
	return nil
}

// UpdateRule cập nhật trạng thái bật/tắt của quy tắc cảnh báo.
func (r *sqliteNotificationRepository) UpdateRule(ctx context.Context, id string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	query := `
		UPDATE notification_rules
		SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`
	res, err := r.db.ExecContext(ctx, query, enabledInt, id)
	if err != nil {
		return fmt.Errorf("cập nhật notification_rules thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("không tìm thấy quy tắc cảnh báo: %s", id)
	}
	return nil
}

// RecordTestResult ghi lại kết quả thử nghiệm gửi thông báo.
func (r *sqliteNotificationRepository) RecordTestResult(ctx context.Context, id string, status string, message string) error {
	query := `
		UPDATE notification_channels
		SET last_tested_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
		    last_test_status = ?,
		    last_test_message = ?
		WHERE id = ?;
	`
	_, err := r.db.ExecContext(ctx, query, status, message, id)
	return err
}

// GetActiveChannelsCount đếm số kênh thông báo đang active.
func (r *sqliteNotificationRepository) GetActiveChannelsCount(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM notification_channels WHERE enabled = 1").Scan(&count)
	return count, err
}
