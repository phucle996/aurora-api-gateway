package entity

// User đại diện cho hồ sơ nhân sự / tài khoản định danh trong hệ thống bảo mật WAF.
//
// [Góc nhìn kinh tế & bảo mật]:
// Tương đương hồ sơ nhân viên trong ngân hàng:
// - ID: Mã số định danh duy nhất của nhân sự.
// - Username: Tên tài khoản dùng để đăng nhập.
// - PasswordHash: Mật khẩu đã được mã hóa một chiều qua thuật toán Argon2id (tuyệt đối không lưu mật khẩu thô).
// - Salt: Chuỗi muối bảo mật ngẫu nhiên dùng để chống tin tặc dùng bảng tra sẵn (Rainbow Table).
// - Role: Quyền hạn được giao (Quản trị viên 'admin', chuyên viên giám sát 'operator'...).
// - CreatedAt / UpdatedAt: Mốc thời gian mở và cập nhật hồ sơ để phục vụ đối soát kiểm toán.
type User struct {
	ID           string
	Username     string
	PasswordHash string
	Salt         string
	Role         string
	CreatedAt    string
	UpdatedAt    string
}

// LoginInput là gói dữ liệu đầu vào khi thực hiện lệnh đăng nhập.
// Đây là thực thể nghiệp vụ thuần túy (Pure Domain Entity), hoàn toàn tách biệt khỏi tầng HTTP Transport DTO.
type LoginInput struct {
	Username string // Tên đăng nhập người dùng nhập vào
	Password string // Mật khẩu người dùng nhập vào (chưa băm)
}

// LoginOutput là kết quả nghiệp vụ sau khi đăng nhập thành công.
// Trả về cho tầng Transport để đóng gói thành thẻ Cookie HttpOnly và JSON phản hồi.
type LoginOutput struct {
	Token     string // Chuỗi mã thẻ căn cước điện tử JWT
	TokenType string // Loại thẻ (mặc định là 'Bearer' - người cầm thẻ có quyền sử dụng)
	ExpiresIn int64  // Thời gian hiệu lực tính bằng giây (ví dụ: 86400 giây = 24 giờ)
	User      User   // Thông tin hồ sơ người dùng được xác thực
}

// ─── GIẢI THÍCH VÌ SAO STRUCT CLAIMS BẮT BUỘC PHẢI CHỨA CÁC THẺ JSON ─────────
//
// [Lý do kỹ thuật & Tiêu chuẩn quốc tế RFC 7519]:
// Struct Claims ở đây KHÔNG PHẢI là HTTP Request/Response DTO (không dùng để nhận/trả API HTTP).
// Thay vào đó, Claims là bản thiết kế cho cấu trúc bên trong của "Thẻ căn cước điện tử" (JWT Payload).
//
// Tiêu chuẩn quốc tế JSON Web Token (RFC 7519) quy định phần thân Token Payload BẮT BUỘC phải là
// một văn bản JSON hợp lệ, được mã hóa Base64URL và ký số điện tử (HMAC-SHA256).
// Trong đó, các tên trường (Claim Names) được tiêu chuẩn hóa toàn cầu bằng các từ viết tắt cố định:
//   - "sub" (Subject)        : ID người dùng / chủ thể được cấp thẻ.
//   - "iss" (Issuer)         : Đơn vị / Cơ quan phát hành thẻ (ở đây là hệ thống "aurora-waf").
//   - "iat" (Issued At)      : Thời điểm đóng dấu cấp thẻ (UNIX Timestamp tính bằng giây).
//   - "exp" (Expiration Time): Thời điểm thẻ hết hạn (UNIX Timestamp).
//   - "username", "role"     : Thông tin tùy biến kèm theo thẻ để các cổng kiểm soát phân quyền nhanh.
//
// Khi máy chủ phát hành token (tạo chữ ký) hoặc kiểm tra thẻ ra vào:
//   - Máy chủ dùng `json.Marshal(claims)` để biến struct này thành văn bản JSON chuẩn RFC 7519.
//   - Máy chủ dùng `json.Unmarshal(payload, &claims)` để đọc dữ liệu từ token giải mã ra.
// Nếu bỏ các thẻ `json:"sub"`, `json:"exp"`... thì thư viện JSON sẽ biến thành chữ hoa ("Subject", "ExpiresAt"),
// làm sai lệch hoàn toàn tiêu chuẩn JWT quốc tế RFC 7519 và các hệ thống khác sẽ không thể đọc hiểu được thẻ này!
type Claims struct {
	Subject   string `json:"sub"`      // RFC 7519: ID của người dùng (Subject)
	Username  string `json:"username"` // Tên đăng nhập được nhúng vào thẻ
	Role      string `json:"role"`     // Vai trò / Thẩm quyền của người dùng (admin, viewer...)
	Issuer    string `json:"iss"`      // RFC 7519: Đơn vị phát hành thẻ (Issuer - aurora-waf)
	IssuedAt  int64  `json:"iat"`      // RFC 7519: Mốc thời gian phát hành (Issued At)
	ExpiresAt int64  `json:"exp"`      // RFC 7519: Mốc thời gian hết hạn (Expiration Time)
}
