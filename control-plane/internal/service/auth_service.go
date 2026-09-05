package service

import (
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

// Các thông số cấu hình cho thuật toán mã hóa mật khẩu Argon2id.
// Argon2id là thuật toán bảo mật tiêu chuẩn cao nhất hiện nay, tiêu tốn cả CPU và bộ nhớ
// để ngăn chặn hacker dùng máy đào hoặc card đồ họa để dò mật khẩu (brute-force).
const (
	argon2Time    = 1         // Số vòng lặp tính toán (1 vòng)
	argon2Memory  = 64 * 1024 // Bộ nhớ RAM yêu cầu: 64 MB
	argon2Threads = 2         // Số luồng CPU sử dụng: 2 luồng song song
	argon2KeyLen  = 32        // Độ dài chuỗi băm đầu ra: 32 bytes (256-bit)
)

// AuthService là giao diện chuẩn (Interface) định nghĩa các chức năng xác thực người dùng trong hệ thống.
type AuthService = port.AuthService

// authService là cấu trúc dữ liệu thực thi các chức năng xác thực.
type authService struct {
	repo repo.AuthRepository // Cổng giao tiếp với cơ sở dữ liệu để truy vấn tài khoản
	cfg  config.Config       // Cấu hình chung của ứng dụng (chứa khóa bí mật JWT, v.v.)
}

// NewAuthService là hàm khởi tạo dịch vụ xác thực, nhận vào kho lưu trữ dữ liệu và cấu hình hệ thống.
func NewAuthService(repo repo.AuthRepository, cfg config.Config) AuthService {
	return &authService{
		repo: repo,
		cfg:  cfg,
	}
}

// HashPasswordArgon2 thực hiện băm mật khẩu dạng văn bản gốc kết hợp với chuỗi muối ngẫu nhiên (salt).
// Salt giúp đảm bảo hai người dùng có cùng mật khẩu vẫn sinh ra hai chuỗi mã hóa hoàn toàn khác nhau.
func HashPasswordArgon2(password string, salt []byte) string {
	hash := argon2.IDKey([]byte(password), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
	return hex.EncodeToString(hash) // Chuyển đổi kết quả băm sang chuỗi hex để dễ lưu trữ
}

// Login xử lý luồng đăng nhập của người dùng:
// 1. Kiểm tra xem tài khoản có tồn tại trong cơ sở dữ liệu không.
// 2. Lấy muối (salt) đã lưu và băm thử mật khẩu người dùng vừa nhập vào.
// 3. So sánh mật khẩu đã băm với mật khẩu trong DB.
// 4. Nếu khớp, tạo một mã JWT (thẻ căn cước điện tử) có hạn dùng 24 giờ gửi lại cho người dùng.
func (s *authService) Login(ctx context.Context, input entity.LoginInput) (*entity.LoginOutput, error) {
	// Bước 1: Tìm người dùng trong database theo tên đăng nhập
	user, err := s.repo.FindByUsername(ctx, input.Username)
	if err != nil {
		if errors.Is(err, taxonomy.ErrUserNotFound) {
			return nil, taxonomy.ErrInvalidCredentials // Không tìm thấy tài khoản -> Báo lỗi sai thông tin
		}
		return nil, err
	}

	// Bước 2: Đọc chuỗi muối (salt) của người dùng từ DB
	saltBytes, err := hex.DecodeString(user.Salt)
	if err != nil {
		return nil, taxonomy.ErrInvalidCredentials
	}

	// Bước 3: Băm mật khẩu người dùng vừa nhập với salt tương ứng
	expectedHash := user.PasswordHash
	actualHash := HashPasswordArgon2(input.Password, saltBytes)

	// So sánh hai chuỗi băm bằng phương pháp Constant-Time Compare.
	// Cách so sánh này luôn mất cùng một lượng thời gian dù chuỗi giống hay khác nhau ở ký tự nào,
	// giúp ngăn chặn hacker đo thời gian phản hồi máy chủ để đoán mật khẩu (Timing Attack).
	if subtle.ConstantTimeCompare([]byte(expectedHash), []byte(actualHash)) != 1 {
		return nil, taxonomy.ErrInvalidCredentials // Mật khẩu không trùng khớp -> Báo lỗi
	}

	// Bước 4: Chuẩn bị thông tin định danh (Claims) để nhúng vào thẻ phiên JWT
	expiresIn := int64(86400) // Thời hạn hiệu lực của phiên: 86400 giây = 24 giờ
	now := time.Now()
	claims := entity.Claims{
		Subject:   user.ID,                      // Mã định danh người dùng
		Username:  user.Username,                // Tên tài khoản
		Role:      user.Role,                    // Quyền hạn (ví dụ: admin)
		Issuer:    "aurora-control-plane",       // Nơi phát hành token
		IssuedAt:  now.Unix(),                   // Thời điểm phát hành
		ExpiresAt: now.Add(24 * time.Hour).Unix(), // Thời điểm hết hạn
	}

	// Tạo chuỗi token JWT có chữ ký số
	tokenString, err := s.generateJWT(claims)
	if err != nil {
		return nil, err
	}

	// Trả về kết quả đăng nhập thành công cùng token và thông tin người dùng
	return &entity.LoginOutput{
		Token:     tokenString,
		TokenType: "Bearer",
		ExpiresIn: expiresIn,
		User: entity.User{
			ID:       user.ID,
			Username: user.Username,
			Role:     user.Role,
		},
	}, nil
}

// generateJWT tạo ra một chuỗi JSON Web Token hoàn chỉnh gồm 3 phần ghép bằng dấu chấm (Header.Payload.Signature):
// - Header: Chứa thông tin thuật toán ký (HS256).
// - Payload: Chứa dữ liệu định danh người dùng (ID, username, role, hạn dùng).
// - Signature: Chữ ký số mã hóa bằng khóa bí mật (Secret Key) để máy chủ phát hiện nếu token bị sửa đổi.
func (s *authService) generateJWT(claims entity.Claims) (string, error) {
	// Phần 1: Khai báo Header
	header := map[string]string{
		"alg": "HS256", // Thuật toán ký số HMAC-SHA256
		"typ": "JWT",   // Loại định dạng token
	}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", err
	}

	// Phần 2: Chuyển đổi thông tin người dùng (Claims) sang dạng JSON
	payloadJSON, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	// Mã hóa Header và Payload sang định dạng Base64URL để truyền an toàn qua mạng
	encodedHeader := base64.RawURLEncoding.EncodeToString(headerJSON)
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	signingInput := encodedHeader + "." + encodedPayload

	// Phần 3: Tạo chữ ký số (Signature) bằng khóa bí mật (JWT Secret)
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(signingInput))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	// Ghép 3 phần lại thành chuỗi JWT chuẩn: Header.Payload.Signature
	return signingInput + "." + signature, nil
}

// ValidateToken nhận vào một chuỗi JWT từ phía người dùng gửi lên và kiểm tra:
// 1. Token có đủ 3 phần hợp lệ hay không.
// 2. Chữ ký số có khớp với chữ ký máy chủ tự tính lại không (phát hiện giả mạo/chỉnh sửa).
// 3. Token đã hết hạn sử dụng chưa.
// Nếu hợp lệ, trả về thông tin người dùng được giải mã từ Payload.
func (s *authService) ValidateToken(tokenString string) (*entity.Claims, error) {
	// Bước 1: Tách token thành 3 phần dựa theo dấu chấm
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, taxonomy.ErrUnauthorized // Cấu trúc token không đúng chuẩn
	}

	// Bước 2: Máy chủ tự ký lại phần Header.Payload bằng khóa bí mật của mình
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(signingInput))
	expectedSignature := mac.Sum(nil)

	// Giải mã chữ ký được đính kèm trong token
	actualSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	// So sánh chữ ký mong đợi và chữ ký thực tế bằng Constant-Time Compare
	if subtle.ConstantTimeCompare(expectedSignature, actualSignature) != 1 {
		return nil, taxonomy.ErrUnauthorized // Chữ ký không khớp -> Token đã bị can thiệp hoặc giả mạo
	}

	// Bước 3: Đọc dữ liệu người dùng từ phần Payload
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	var claims entity.Claims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	// Bước 4: Kiểm tra thời hạn của token
	if claims.ExpiresAt < time.Now().Unix() {
		return nil, taxonomy.ErrUnauthorized // Token đã quá hạn 24 giờ -> Yêu cầu đăng nhập lại
	}

	return &claims, nil // Token hoàn toàn hợp lệ
}
