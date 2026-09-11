package taxonomy

import "errors"


// ─── Access Domain Errors ─────────────────────────────────────────────────────

var (
	// ErrAccessInvalid phát sinh khi cấu hình access control không hợp lệ
	ErrAccessInvalid = errors.New("invalid access configuration")

	// ErrAccessConflict phát sinh khi xung đột version access object
	ErrAccessConflict = errors.New("access configuration changed; refresh before retrying")

	// ErrAccessMissing phát sinh khi không tìm thấy resource access
	ErrAccessMissing = errors.New("access resource not found")

	// ErrAccessCompiler phát sinh khi access compiler reject snapshot hoặc không khả dụng
	ErrAccessCompiler = errors.New("access compiler rejected snapshot or is unavailable")
)

// ─── Auth Domain Errors ───────────────────────────────────────────────────────

var (
	// ErrInvalidCredentials phát sinh khi tên đăng nhập hoặc mật khẩu không chính xác
	ErrInvalidCredentials = errors.New("invalid username or password")

	// ErrUnauthorized phát sinh khi token không hợp lệ hoặc đã hết hạn
	ErrUnauthorized = errors.New("unauthorized")

	// ErrUserNotFound phát sinh khi tài khoản người dùng không tồn tại
	ErrUserNotFound = errors.New("user not found")

	// ErrInvalid2FACode phát sinh khi mã OTP 2FA hoặc recovery code không chính xác hoặc hết hạn
	ErrInvalid2FACode = errors.New("invalid two-factor authentication code")
)

// ─── Metrics & Integration Domain Errors ──────────────────────────────────────

var (
	// ErrMetricsUnavailable phát sinh khi máy chủ Prometheus không khả dụng hoặc phản hồi lỗi
	ErrMetricsUnavailable = errors.New("metrics provider unavailable or unreachable")

	// ErrMetricsDisabled phát sinh khi tích hợp metrics đang ở trạng thái tắt
	ErrMetricsDisabled = errors.New("metrics integration is disabled")
)

// ─── Settings Domain Errors ───────────────────────────────────────────────────

var (
	// ErrSettingsStorage phát sinh khi có lỗi truy vấn hoặc lưu trữ cấu hình hệ thống
	ErrSettingsStorage = errors.New("system settings storage error")
)
