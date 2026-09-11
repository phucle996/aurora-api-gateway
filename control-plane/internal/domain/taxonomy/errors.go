package taxonomy

import "errors"


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

// ─── L4 Gateway Domain Errors ─────────────────────────────────────────────────

var (
	// ErrL4UpstreamNotFound phát sinh khi không tìm thấy L4 upstream
	ErrL4UpstreamNotFound = errors.New("l4 upstream not found")

	// ErrL4UpstreamExists phát sinh khi trùng tên L4 upstream
	ErrL4UpstreamExists = errors.New("l4 upstream already exists")

	// ErrL4UpstreamInUse phát sinh khi xóa L4 upstream đang được liên kết bởi service
	ErrL4UpstreamInUse = errors.New("l4 upstream is currently in use by active l4 services")

	// ErrL4ServiceNotFound phát sinh khi không tìm thấy L4 service
	ErrL4ServiceNotFound = errors.New("l4 service not found")

	// ErrL4PortConflict phát sinh khi port và protocol đã được sử dụng bởi service khác
	ErrL4PortConflict = errors.New("l4 service port and protocol already in use")

	// ErrL4InvalidPort phát sinh khi port nằm ngoài dải 1-65535
	ErrL4InvalidPort = errors.New("l4 port must be between 1 and 65535")

	// ErrL4InvalidCIDR phát sinh khi CIDR trong ACL rule không đúng định dạng
	ErrL4InvalidCIDR = errors.New("invalid cidr address format in l4 acl")

	// ErrL4InvalidEndpoint phát sinh khi direct endpoint không đúng định dạng host:port
	ErrL4InvalidEndpoint = errors.New("invalid direct endpoint format, expected host:port")

	// ErrL4TargetRequired phát sinh khi không có upstream hoặc direct endpoint được chỉ định
	ErrL4TargetRequired = errors.New("either upstream or direct endpoint must be specified")
)

