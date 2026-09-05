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
