package dto

// UpdateAuthProviderRequest là request body để cập nhật trạng thái và cấu hình 1 provider.
type UpdateAuthProviderRequest struct {
	Enabled    bool   `json:"enabled"`
	ConfigJSON string `json:"config_json"`
}

// Verify2FARequest là request body để kích hoạt 2FA với mã 6 số.
type Verify2FARequest struct {
	Secret string `json:"secret" binding:"required"`
	Code   string `json:"code" binding:"required"`
}

// ChangePasswordRequest là request body để đổi mật khẩu tài khoản người dùng.
type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=8"`
}
