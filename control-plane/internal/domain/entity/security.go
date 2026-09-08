package entity

// AuthProviderItem đại diện cho một phương thức xác thực người dùng trong hệ thống:
// local, oidc, ldap, saml.
type AuthProviderItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	ConfigJSON  string `json:"config_json"`
	UpdatedAt   string `json:"updated_at"`
}

// TwoFactorStatus phản ánh trạng thái kích hoạt 2FA của tài khoản người dùng hiện tại.
type TwoFactorStatus struct {
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"`
	ConfiguredAt string `json:"configured_at"`
}

// SecurityOverview là flat projection toàn cảnh trang Security Settings.
type SecurityOverview struct {
	AuthProviders       []AuthProviderItem `json:"auth_providers"`
	TwoFactor           TwoFactorStatus    `json:"two_factor"`
	AdminUsername       string             `json:"admin_username"`
	PasswordLastUpdated string             `json:"password_last_updated"`
}

// Init2FAOutput chứa thông tin cấp mới cho người dùng để quét mã QR và lưu secret.
type Init2FAOutput struct {
	Secret     string `json:"secret"`
	OtpAuthURL string `json:"otpauth_url"`
	QrSVG      string `json:"qr_svg"`
}

// Verify2FACommand mang dữ liệu mã xác thực người dùng gửi lên để kích hoạt 2FA.
type Verify2FACommand struct {
	Secret string `json:"secret"`
	Code   string `json:"code"`
}

// Verify2FAOutput trả về kết quả kích hoạt cùng danh sách mã khôi phục khẩn cấp.
type Verify2FAOutput struct {
	Enabled       bool     `json:"enabled"`
	RecoveryCodes []string `json:"recovery_codes"`
}

// ChangePasswordCommand nhận mật khẩu hiện tại và mật khẩu mới để đổi thông tin đăng nhập.
type ChangePasswordCommand struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}
