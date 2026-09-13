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
	if repo == nil {
		panic("authRepo cannot be nil")
	}
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

	// Nếu tài khoản có bật 2FA, kiểm tra mã 2FA
	if user.TwoFactorEnabled {
		if input.Code != "" {
			// Người dùng gửi kèm mã 2FA (TOTP hoặc Recovery Code) ngay ở bước 1
			valid, err := s.verifyUser2FACode(ctx, user, input.Code)
			if err != nil || !valid {
				return nil, taxonomy.ErrInvalid2FACode
			}
			// Mã hợp lệ, tiến hành cấp token phiên bên dưới
		} else {
			// Yêu cầu xác thực bước 2: sinh token tạm thời 5 phút với typ="2fa_pending"
			now := time.Now()
			tempClaims := entity.Claims{
				Subject:   user.ID,
				Username:  user.Username,
				Role:      user.Role,
				Issuer:    "aurora-control-plane",
				IssuedAt:  now.Unix(),
				ExpiresAt: now.Add(5 * time.Minute).Unix(),
				Type:      "2fa_pending",
			}
			tempToken, err := s.generateJWT(tempClaims)
			if err != nil {
				return nil, err
			}
			return &entity.LoginOutput{
				Requires2FA:    true,
				TwoFactorToken: tempToken,
			}, nil
		}
	}

	// Bước 4: Chuẩn bị thông tin định danh (Claims) để nhúng vào thẻ phiên JWT
	expiresIn := int64(86400) // Thời hạn hiệu lực của phiên: 86400 giây = 24 giờ
	now := time.Now()
	claims := entity.Claims{
		Subject:   user.ID,                        // Mã định danh người dùng
		Username:  user.Username,                  // Tên tài khoản
		Role:      user.Role,                      // Quyền hạn (ví dụ: admin)
		Issuer:    "aurora-control-plane",         // Nơi phát hành token
		IssuedAt:  now.Unix(),                     // Thời điểm phát hành
		ExpiresAt: now.Add(24 * time.Hour).Unix(), // Thời điểm hết hạn
		Type:      "session",
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

// Verify2FALogin xác thực mã OTP 2FA từ màn hình thử thách bước 2 và cấp phiên đăng nhập chính thức.
func (s *authService) Verify2FALogin(ctx context.Context, input entity.Verify2FALoginInput) (*entity.LoginOutput, error) {
	if strings.TrimSpace(input.TwoFactorToken) == "" || strings.TrimSpace(input.Code) == "" {
		return nil, taxonomy.ErrInvalid2FACode
	}

	// Xác thực chữ ký token tạm thời 2FA
	claims, err := s.validateTokenInternal(input.TwoFactorToken)
	if err != nil || claims == nil || claims.Type != "2fa_pending" {
		return nil, taxonomy.ErrUnauthorized
	}

	// Tra cứu thông tin người dùng theo ID từ token
	user, err := s.repo.FindByID(ctx, claims.Subject)
	if err != nil {
		return nil, taxonomy.ErrUserNotFound
	}

	if !user.TwoFactorEnabled {
		return nil, errors.New("tài khoản chưa kích hoạt xác thực 2 bước")
	}

	// Kiểm tra mã OTP 6 số hoặc mã dự phòng
	valid, err := s.verifyUser2FACode(ctx, user, input.Code)
	if err != nil || !valid {
		return nil, taxonomy.ErrInvalid2FACode
	}

	// Mã chính xác! Cấp phiên làm việc JWT chính thức (24 giờ)
	expiresIn := int64(86400)
	now := time.Now()
	sessionClaims := entity.Claims{
		Subject:   user.ID,
		Username:  user.Username,
		Role:      user.Role,
		Issuer:    "aurora-control-plane",
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(24 * time.Hour).Unix(),
		Type:      "session",
	}

	tokenString, err := s.generateJWT(sessionClaims)
	if err != nil {
		return nil, err
	}

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

// verifyUser2FACode kiểm tra mã nhập vào có khớp với mã TOTP 6 số hoặc một trong các mã khôi phục không.
func (s *authService) verifyUser2FACode(ctx context.Context, user *entity.User, code string) (bool, error) {
	cleanCode := strings.TrimSpace(code)
	if cleanCode == "" {
		return false, nil
	}

	// 1. Kiểm tra mã TOTP RFC 6238 chuẩn 6 chữ số
	if len(cleanCode) == 6 && user.TwoFactorSecret != "" {
		valid, err := validateTOTP(user.TwoFactorSecret, cleanCode, 1)
		if err == nil && valid {
			return true, nil
		}
	}

	// 2. Kiểm tra mã khôi phục dự phòng (Recovery Codes)
	normCode := strings.ToUpper(cleanCode)
	if user.TwoFactorRecoveryCodes != "" && user.TwoFactorRecoveryCodes != "[]" {
		var codes []string
		if err := json.Unmarshal([]byte(user.TwoFactorRecoveryCodes), &codes); err == nil {
			matchedIdx := -1
			for i, c := range codes {
				if strings.ToUpper(strings.TrimSpace(c)) == normCode {
					matchedIdx = i
					break
				}
			}
			if matchedIdx >= 0 {
				// Tiêu hủy mã đã sử dụng khỏi danh sách
				updatedCodes := append(codes[:matchedIdx], codes[matchedIdx+1:]...)
				updatedJSON, err := json.Marshal(updatedCodes)
				if err == nil {
					_ = s.repo.UpdateRecoveryCodes(ctx, user.ID, string(updatedJSON))
				}
				return true, nil
			}
		}
	}

	return false, nil
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

// validateTokenInternal giải mã và kiểm tra tính toàn vẹn của token JWT mà không lọc theo Type.
func (s *authService) validateTokenInternal(tokenString string) (*entity.Claims, error) {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return nil, taxonomy.ErrUnauthorized
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(s.cfg.JWTSecret))
	mac.Write([]byte(signingInput))
	expectedSignature := mac.Sum(nil)

	actualSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	if subtle.ConstantTimeCompare(expectedSignature, actualSignature) != 1 {
		return nil, taxonomy.ErrUnauthorized
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	var claims entity.Claims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil, taxonomy.ErrUnauthorized
	}

	if claims.ExpiresAt < time.Now().Unix() {
		return nil, taxonomy.ErrUnauthorized
	}

	return &claims, nil
}

// ValidateToken nhận vào một chuỗi JWT từ phía người dùng gửi lên và kiểm tra:
// Token phải là token phiên làm việc chính thức (Type != "2fa_pending").
func (s *authService) ValidateToken(tokenString string) (*entity.Claims, error) {
	claims, err := s.validateTokenInternal(tokenString)
	if err != nil {
		return nil, err
	}
	// Ngăn chặn việc dùng token 2fa_pending để truy cập các tài nguyên API được bảo vệ
	if claims.Type == "2fa_pending" {
		return nil, taxonomy.ErrUnauthorized
	}
	return claims, nil
}
