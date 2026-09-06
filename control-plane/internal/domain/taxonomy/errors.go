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

// ─── Policy Domain Errors ─────────────────────────────────────────────────────

var (
	// ErrPolicyConflict phát sinh khi xung đột version policy hoặc cluster
	ErrPolicyConflict = errors.New("policy or cluster revision changed; refresh before retrying")

	// ErrPolicyInvalid phát sinh khi cấu hình policy không hợp lệ
	ErrPolicyInvalid = errors.New("invalid policy: check name, scope, mode, priority and selected rules")

	// ErrPolicyNotFound phát sinh khi không tìm thấy policy hoặc node
	ErrPolicyNotFound = errors.New("policy or node not found")

	// ErrPolicyUnsupported phát sinh khi phiên bản rule được chọn bị tắt hoặc không được runtime hỗ trợ
	ErrPolicyUnsupported = errors.New("selected rule revision is disabled or unsupported by the runtime")
)

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
