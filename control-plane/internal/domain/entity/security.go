package entity

// Tuân thủ Flat Entity: không chứa json tags.

// AuthProviderItem đại diện cho một phương thức xác thực người dùng trong hệ thống:
// local, oidc, ldap, saml.
type AuthProviderItem struct {
	ID          string
	Name        string
	Description string
	Enabled     bool
	ConfigJSON  string
	UpdatedAt   string
}

// TwoFactorStatus phản ánh trạng thái kích hoạt 2FA của tài khoản người dùng hiện tại.
type TwoFactorStatus struct {
	Enabled      bool
	Configured   bool
	ConfiguredAt string
}

// SecurityOverview là flat projection toàn cảnh trang Security Settings.
type SecurityOverview struct {
	AuthProviders       []AuthProviderItem
	TwoFactor           TwoFactorStatus
	AdminUsername       string
	PasswordLastUpdated string
}

// Init2FAOutput chứa thông tin cấp mới cho người dùng để quét mã QR và lưu secret.
type Init2FAOutput struct {
	Secret     string
	OtpAuthURL string
	QrSVG      string
}

// Verify2FACommand mang dữ liệu mã xác thực người dùng gửi lên để kích hoạt 2FA.
type Verify2FACommand struct {
	Secret string
	Code   string
}

// Verify2FAOutput trả về kết quả kích hoạt cùng danh sách mã khôi phục khẩn cấp.
type Verify2FAOutput struct {
	Enabled       bool
	RecoveryCodes []string
}

// ChangePasswordCommand nhận mật khẩu hiện tại và mật khẩu mới để đổi thông tin đăng nhập.
type ChangePasswordCommand struct {
	CurrentPassword string
	NewPassword     string
}
