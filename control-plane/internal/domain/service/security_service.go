package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// SecurityService định nghĩa các nghiệp vụ cốt lõi của hệ thống bảo mật & định danh.
type SecurityService interface {
	// GetOverview trả về toàn cảnh bảo mật (các provider, 2FA, lần cập nhật mật khẩu gần nhất).
	GetOverview(ctx context.Context, userID string) (*entity.SecurityOverview, error)
	// UpdateProvider cập nhật cấu hình và trạng thái của một provider xác thực.
	UpdateProvider(ctx context.Context, id string, enabled bool, configJSON string) error
	// Init2FA khởi tạo phiên thiết lập 2FA, sinh secret chuẩn base32 và mã QR vector SVG.
	Init2FA(ctx context.Context, userID string, username string) (*entity.Init2FAOutput, error)
	// Verify2FA xác thực mã 6 số TOTP và kích hoạt 2FA, trả về mã recovery.
	Verify2FA(ctx context.Context, userID string, cmd entity.Verify2FACommand) (*entity.Verify2FAOutput, error)
	// Disable2FA tắt xác thực hai yếu tố cho tài khoản.
	Disable2FA(ctx context.Context, userID string) error
	// ChangePassword kiểm tra mật khẩu cũ và cập nhật mật khẩu mới bằng Argon2id.
	ChangePassword(ctx context.Context, userID string, cmd entity.ChangePasswordCommand) error
}
