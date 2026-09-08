package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// SecurityRepository là cổng lưu trữ và truy vấn cấu hình bảo mật hệ thống.
type SecurityRepository interface {
	// GetOverview trả về toàn bộ thông tin tổng quan bảo mật của hệ thống và người dùng.
	GetOverview(ctx context.Context, userID string) (*entity.SecurityOverview, error)
	// ListProviders trả về danh sách các nhà cung cấp xác thực.
	ListProviders(ctx context.Context) ([]entity.AuthProviderItem, error)
	// UpdateProvider cập nhật trạng thái kích hoạt và cấu hình JSON của 1 provider.
	UpdateProvider(ctx context.Context, id string, enabled bool, configJSON string) error
	// GetActiveProvidersCount đếm số lượng provider đang bật để đảm bảo invariant không bị khóa tài khoản.
	GetActiveProvidersCount(ctx context.Context) (int, error)
	// GetUserSecurity lấy thông tin bảo mật hiện tại của người dùng (bao gồm hash, salt, 2FA).
	GetUserSecurity(ctx context.Context, userID string) (*entity.User, error)
	// SaveUser2FASetup lưu thông tin 2FA đã xác thực thành công.
	SaveUser2FASetup(ctx context.Context, userID string, secret string, recoveryCodesJSON string) error
	// DisableUser2FA vô hiệu hóa 2FA cho người dùng.
	DisableUser2FA(ctx context.Context, userID string) error
	// UpdateUserPassword cập nhật mật khẩu mới (Argon2id hash và salt).
	UpdateUserPassword(ctx context.Context, userID string, newHash string, newSalt string) error
}
