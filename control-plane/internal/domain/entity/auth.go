package entity

// User đại diện cho tài khoản người dùng trong hệ thống WAF:
// - ID: Mã định danh duy nhất của tài khoản.
// - Username: Tên đăng nhập.
// - PasswordHash: Mật khẩu đã được mã hóa một chiều bằng Argon2id.
// - Salt: Chuỗi muối ngẫu nhiên dùng khi băm mật khẩu.
// - Role: Vai trò và quyền hạn (admin, operator, viewer...).
// - CreatedAt / UpdatedAt: Thời điểm tạo và cập nhật tài khoản.
type User struct {
	ID                     string
	Username               string
	PasswordHash           string
	Salt                   string
	Role                   string
	TwoFactorEnabled       bool
	TwoFactorSecret        string
	TwoFactorRecoveryCodes string
	TwoFactorConfiguredAt  string
	CreatedAt              string
	UpdatedAt              string
}

// LoginInput là gói dữ liệu đầu vào khi thực hiện đăng nhập.
type LoginInput struct {
	Username string // Tên đăng nhập
	Password string // Mật khẩu người dùng nhập vào
	Code     string // Mã xác thực 2FA TOTP hoặc mã dự phòng (tùy chọn)
}

// LoginOutput là kết quả trả về sau khi xác thực đăng nhập.
type LoginOutput struct {
	Requires2FA    bool   // Báo hiệu tài khoản yêu cầu xác thực bước 2 (2FA)
	TwoFactorToken string // Token tạm thời hiệu lực 5 phút để hoàn tất 2FA
	Token          string // Chuỗi mã xác thực JWT phiên làm việc chính thức
	TokenType      string // Loại token (mặc định là 'Bearer')
	ExpiresIn      int64  // Thời gian hiệu lực tính bằng giây
	User           User   // Thông tin tài khoản người dùng
}

// Verify2FALoginInput là dữ liệu gửi lên để xác thực bước 2 khi đăng nhập.
type Verify2FALoginInput struct {
	TwoFactorToken string // Token tạm thời từ bước 1
	Code           string // Mã TOTP 6 số hoặc mã dự phòng WAF-XXXX-XXXX
}

// Claims định nghĩa cấu trúc payload bên trong JWT theo chuẩn RFC 7519.
// Các thẻ json (sub, iss, iat, exp...) là bắt buộc để mã hóa/giải mã đúng định dạng tên trường chuẩn của token RFC 7519.
type Claims struct {
	Subject   string `json:"sub"`           // ID người dùng (Subject) theo RFC 7519
	Username  string `json:"username"`      // Tên đăng nhập
	Role      string `json:"role"`          // Quyền hạn / vai trò của người dùng
	Issuer    string `json:"iss"`           // Đơn vị phát hành token (Issuer: aurora-waf) theo RFC 7519
	IssuedAt  int64  `json:"iat"`           // Thời điểm phát hành token (UNIX timestamp)
	ExpiresAt int64  `json:"exp"`           // Thời điểm token hết hạn (UNIX timestamp)
	Type      string `json:"typ,omitempty"` // Loại token: "session" hoặc "2fa_pending"
}
