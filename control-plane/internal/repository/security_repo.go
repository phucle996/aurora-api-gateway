package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type sqliteSecurityRepository struct {
	db *sql.DB
}

// NewSecurityRepository khởi tạo repository quản lý lưu trữ cài đặt bảo mật qua SQLite.
func NewSecurityRepository(db *sql.DB) repo.SecurityRepository {
	return &sqliteSecurityRepository{db: db}
}

// GetOverview trả về toàn bộ thông tin tổng quan bảo mật từ cơ sở dữ liệu.
func (r *sqliteSecurityRepository) GetOverview(ctx context.Context, userID string) (*entity.SecurityOverview, error) {
	// 1. CTE query lấy danh sách Auth Providers
	const providersQuery = `
		WITH providers_cte AS (
			SELECT id, name, description, enabled, config_json, updated_at
			FROM auth_providers
			ORDER BY CASE id 
				WHEN 'local' THEN 1 
				WHEN 'oidc' THEN 2 
				WHEN 'ldap' THEN 3 
				WHEN 'saml' THEN 4 
				ELSE 5 
			END
		)
		SELECT id, name, description, enabled, config_json, updated_at
		FROM providers_cte;
	`

	rows, err := r.db.QueryContext(ctx, providersQuery)
	if err != nil {
		return nil, fmt.Errorf("truy vấn auth_providers thất bại: %w", err)
	}
	defer rows.Close()

	var providers []entity.AuthProviderItem
	for rows.Next() {
		var item entity.AuthProviderItem
		var enabledInt int
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &enabledInt, &item.ConfigJSON, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("đọc bản ghi auth_provider thất bại: %w", err)
		}
		item.Enabled = enabledInt == 1
		providers = append(providers, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// 2. CTE query lấy thông tin người dùng hiện tại
	const userQuery = `
		WITH target_user AS (
			SELECT id, username, two_factor_enabled, two_factor_configured_at, updated_at
			FROM users
			WHERE id = ? OR LOWER(username) = LOWER(?)
			LIMIT 1
		)
		SELECT id, username, two_factor_enabled, two_factor_configured_at, updated_at
		FROM target_user;
	`

	var (
		uID                  string
		username             string
		twoFaEnabledInt      int
		twoFaConfiguredAtVal sql.NullString
		updatedAtVal         sql.NullString
	)

	err = r.db.QueryRowContext(ctx, userQuery, userID, userID).Scan(
		&uID,
		&username,
		&twoFaEnabledInt,
		&twoFaConfiguredAtVal,
		&updatedAtVal,
	)

	overview := &entity.SecurityOverview{
		AuthProviders: providers,
		AdminUsername: "admin",
		TwoFactor: entity.TwoFactorStatus{
			Enabled:    false,
			Configured: false,
		},
		PasswordLastUpdated: "Recently",
	}

	if err == nil {
		overview.AdminUsername = username
		overview.TwoFactor.Enabled = twoFaEnabledInt == 1
		overview.TwoFactor.Configured = twoFaConfiguredAtVal.Valid && twoFaConfiguredAtVal.String != ""
		if twoFaConfiguredAtVal.Valid {
			overview.TwoFactor.ConfiguredAt = twoFaConfiguredAtVal.String
		}
		if updatedAtVal.Valid && updatedAtVal.String != "" {
			overview.PasswordLastUpdated = updatedAtVal.String
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("truy vấn thông tin tài khoản thất bại: %w", err)
	}

	return overview, nil
}

// ListProviders lấy danh sách toàn bộ providers.
func (r *sqliteSecurityRepository) ListProviders(ctx context.Context) ([]entity.AuthProviderItem, error) {
	const query = `
		WITH list_cte AS (
			SELECT id, name, description, enabled, config_json, updated_at
			FROM auth_providers
			ORDER BY id ASC
		)
		SELECT id, name, description, enabled, config_json, updated_at FROM list_cte;
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []entity.AuthProviderItem
	for rows.Next() {
		var item entity.AuthProviderItem
		var enabledInt int
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &enabledInt, &item.ConfigJSON, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.Enabled = enabledInt == 1
		list = append(list, item)
	}
	return list, rows.Err()
}

// UpdateProvider cập nhật trạng thái và cấu hình JSON của provider.
func (r *sqliteSecurityRepository) UpdateProvider(ctx context.Context, id string, enabled bool, configJSON string) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}

	const query = `
		UPDATE auth_providers
		SET enabled = ?, config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`
	res, err := r.db.ExecContext(ctx, query, enabledInt, configJSON, id)
	if err != nil {
		return fmt.Errorf("cập nhật auth_provider thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fmt.Errorf("không tìm thấy auth_provider với ID: %s", id)
	}
	return nil
}

// GetActiveProvidersCount đếm số lượng provider đang được kích hoạt.
func (r *sqliteSecurityRepository) GetActiveProvidersCount(ctx context.Context) (int, error) {
	const query = `SELECT COUNT(*) FROM auth_providers WHERE enabled = 1;`
	var count int
	if err := r.db.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// GetUserSecurity tra cứu thông tin bảo mật đầy đủ của người dùng.
func (r *sqliteSecurityRepository) GetUserSecurity(ctx context.Context, userID string) (*entity.User, error) {
	const query = `
		WITH target_user AS (
			SELECT id, username, password_hash, salt, role,
			       two_factor_enabled,
			       two_factor_secret,
			       two_factor_recovery_codes,
			       two_factor_configured_at,
			       created_at, updated_at
			FROM users
			WHERE id = ? OR LOWER(username) = LOWER(?)
			LIMIT 1
		)
		SELECT id, username, password_hash, salt, role,
		       two_factor_enabled, two_factor_secret, two_factor_recovery_codes, two_factor_configured_at,
		       created_at, updated_at
		FROM target_user;
	`

	var u entity.User
	var twoFaInt int
	err := r.db.QueryRowContext(ctx, query, userID, userID).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.Salt,
		&u.Role,
		&twoFaInt,
		&u.TwoFactorSecret,
		&u.TwoFactorRecoveryCodes,
		&u.TwoFactorConfiguredAt,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrUserNotFound
		}
		return nil, err
	}
	u.TwoFactorEnabled = twoFaInt == 1
	return &u, nil
}

// SaveUser2FASetup cập nhật thông tin 2FA sau khi xác thực thành công.
func (r *sqliteSecurityRepository) SaveUser2FASetup(ctx context.Context, userID string, secret string, recoveryCodesJSON string) error {
	const query = `
		UPDATE users
		SET two_factor_enabled = 1,
		    two_factor_secret = ?,
		    two_factor_recovery_codes = ?,
		    two_factor_configured_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ? OR LOWER(username) = LOWER(?);
	`
	res, err := r.db.ExecContext(ctx, query, secret, recoveryCodesJSON, userID, userID)
	if err != nil {
		return fmt.Errorf("lưu 2FA thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return taxonomy.ErrUserNotFound
	}
	return nil
}

// DisableUser2FA vô hiệu hóa 2FA cho người dùng.
func (r *sqliteSecurityRepository) DisableUser2FA(ctx context.Context, userID string) error {
	const query = `
		UPDATE users
		SET two_factor_enabled = 0,
		    two_factor_secret = '',
		    two_factor_recovery_codes = '[]',
		    two_factor_configured_at = '',
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ? OR LOWER(username) = LOWER(?);
	`
	res, err := r.db.ExecContext(ctx, query, userID, userID)
	if err != nil {
		return fmt.Errorf("vô hiệu hóa 2FA thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return taxonomy.ErrUserNotFound
	}
	return nil
}

// UpdateUserPassword cập nhật mật khẩu băm Argon2id và salt mới.
func (r *sqliteSecurityRepository) UpdateUserPassword(ctx context.Context, userID string, newHash string, newSalt string) error {
	const query = `
		UPDATE users
		SET password_hash = ?,
		    salt = ?,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ? OR LOWER(username) = LOWER(?);
	`
	res, err := r.db.ExecContext(ctx, query, newHash, newSalt, userID, userID)
	if err != nil {
		return fmt.Errorf("cập nhật mật khẩu thất bại: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return taxonomy.ErrUserNotFound
	}
	return nil
}
