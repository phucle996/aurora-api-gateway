package taxonomy

import "errors"

// ─── Rule Domain Errors ───────────────────────────────────────────────────────

var (
	// ErrRuleInvalid phát sinh khi dữ liệu hoặc cấu hình rule không hợp lệ
	ErrRuleInvalid = errors.New("invalid or unsupported rule")

	// ErrRuleConflict phát sinh khi xung đột version (optimistic lock) hoặc idempotency key trùng với payload khác
	ErrRuleConflict = errors.New("rule revision or idempotency conflict")

	// ErrRuleNotFound phát sinh khi không tìm thấy rule trong database
	ErrRuleNotFound = errors.New("rule not found")

	// ErrPublishUnavailable phát sinh khi compiler không khả dụng hoặc reject cấu hình
	ErrPublishUnavailable = errors.New("compiler unavailable or policy rejected")
)

// ─── Auth Domain Errors ───────────────────────────────────────────────────────

var (
	// ErrInvalidCredentials phát sinh khi tên đăng nhập hoặc mật khẩu không chính xác
	ErrInvalidCredentials = errors.New("invalid username or password")

	// ErrUnauthorized phát sinh khi token không hợp lệ hoặc đã hết hạn
	ErrUnauthorized = errors.New("unauthorized")

	// ErrUserNotFound phát sinh khi tài khoản người dùng không tồn tại
	ErrUserNotFound = errors.New("user not found")
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


