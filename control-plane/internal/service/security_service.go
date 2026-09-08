package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type securityService struct {
	repo repo.SecurityRepository
}

// NewSecurityService khởi tạo dịch vụ bảo mật & xác thực.
func NewSecurityService(repo repo.SecurityRepository) port.SecurityService {
	return &securityService{repo: repo}
}

// GetOverview trả về tổng quan trạng thái bảo mật của hệ thống và người dùng.
func (s *securityService) GetOverview(ctx context.Context, userID string) (*entity.SecurityOverview, error) {
	return s.repo.GetOverview(ctx, userID)
}

// UpdateProvider kiểm tra và cập nhật cấu hình cho phương thức xác thực.
func (s *securityService) UpdateProvider(ctx context.Context, id string, enabled bool, configJSON string) error {
	// Invariant 1: Không cho phép tắt hết tất cả auth providers để tránh lockout
	if !enabled {
		activeCount, err := s.repo.GetActiveProvidersCount(ctx)
		if err != nil {
			return err
		}
		if activeCount <= 1 {
			return errors.New("không thể tắt phương thức xác thực này vì hệ thống cần ít nhất 1 phương thức hoạt động")
		}
	}

	// Validate JSON config
	if configJSON == "" {
		configJSON = "{}"
	}
	if !json.Valid([]byte(configJSON)) {
		return errors.New("cấu hình provider phải là định dạng JSON hợp lệ")
	}

	return s.repo.UpdateProvider(ctx, id, enabled, configJSON)
}

// Init2FA sinh secret base32 ngẫu nhiên (160 bits) và URL chuẩn otpauth.
func (s *securityService) Init2FA(ctx context.Context, userID string, username string) (*entity.Init2FAOutput, error) {
	if username == "" {
		username = "admin"
	}

	// 20 bytes = 160-bit entropy theo khuyến nghị RFC 4226 / 6238
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("không thể sinh secret ngẫu nhiên: %w", err)
	}

	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
	otpauthURL := fmt.Sprintf("otpauth://totp/AuroraWAF:%s?secret=%s&issuer=AuroraWAF", username, secret)

	return &entity.Init2FAOutput{
		Secret:     secret,
		OtpAuthURL: otpauthURL,
		QrSVG:      "", // Frontend sẽ render QR bằng lib qrcode từ OtpAuthURL
	}, nil
}

// Verify2FA xác thực mã 6 số TOTP RFC 6238 và cấp mã dự phòng 1 lần.
func (s *securityService) Verify2FA(ctx context.Context, userID string, cmd entity.Verify2FACommand) (*entity.Verify2FAOutput, error) {
	code := strings.TrimSpace(cmd.Code)
	secret := strings.TrimSpace(cmd.Secret)

	if len(code) != 6 {
		return nil, errors.New("mã xác thực phải gồm đúng 6 chữ số")
	}
	if secret == "" {
		return nil, errors.New("thiếu secret key xác thực")
	}

	// Xác thực mã 6 số theo RFC 6238
	valid, err := validateTOTP(secret, code, 1) // Tolerance +-1 step (30s)
	if err != nil {
		return nil, fmt.Errorf("lỗi kiểm tra mã TOTP: %w", err)
	}
	if !valid {
		return nil, errors.New("mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại thời gian trên thiết bị")
	}

	// Sinh 6 mã dự phòng một lần dùng (Backup Recovery Codes)
	recoveryCodes := generateRecoveryCodes(6)
	recoveryJSON, err := json.Marshal(recoveryCodes)
	if err != nil {
		return nil, err
	}

	// Lưu 2FA vào database
	if err := s.repo.SaveUser2FASetup(ctx, userID, secret, string(recoveryJSON)); err != nil {
		return nil, err
	}

	return &entity.Verify2FAOutput{
		Enabled:       true,
		RecoveryCodes: recoveryCodes,
	}, nil
}

// Disable2FA tắt 2FA cho tài khoản.
func (s *securityService) Disable2FA(ctx context.Context, userID string) error {
	return s.repo.DisableUser2FA(ctx, userID)
}

// ChangePassword kiểm tra mật khẩu hiện tại và cập nhật mật khẩu mới bằng Argon2id.
func (s *securityService) ChangePassword(ctx context.Context, userID string, cmd entity.ChangePasswordCommand) error {
	if cmd.CurrentPassword == "" {
		return errors.New("vui lòng nhập mật khẩu hiện tại")
	}
	if len(cmd.NewPassword) < 8 {
		return errors.New("mật khẩu mới phải có độ dài tối thiểu 8 ký tự")
	}
	if cmd.CurrentPassword == cmd.NewPassword {
		return errors.New("mật khẩu mới không được trùng với mật khẩu hiện tại")
	}

	// Lấy thông tin user hiện tại từ database
	user, err := s.repo.GetUserSecurity(ctx, userID)
	if err != nil {
		return fmt.Errorf("không tìm thấy thông tin tài khoản: %w", err)
	}

	// Xác thực mật khẩu cũ bằng Argon2id
	saltBytes, err := hex.DecodeString(user.Salt)
	if err != nil {
		return errors.New("lỗi phân tích salt mật khẩu trong hệ thống")
	}

	expectedHash := user.PasswordHash
	actualHash := HashPasswordArgon2(cmd.CurrentPassword, saltBytes)

	// Constant-time compare
	if subtle.ConstantTimeCompare([]byte(expectedHash), []byte(actualHash)) != 1 {
		return errors.New("mật khẩu hiện tại không chính xác")
	}

	// Sinh salt mới ngẫu nhiên 16 bytes
	newSaltBytes := make([]byte, 16)
	if _, err := rand.Read(newSaltBytes); err != nil {
		return fmt.Errorf("sinh chuỗi muối thất bại: %w", err)
	}
	newSaltHex := hex.EncodeToString(newSaltBytes)

	// Băm mật khẩu mới bằng Argon2id
	newHash := HashPasswordArgon2(cmd.NewPassword, newSaltBytes)

	// Lưu mật khẩu mới vào cơ sở dữ liệu
	return s.repo.UpdateUserPassword(ctx, userID, newHash, newSaltHex)
}

// validateTOTP triển khai RFC 6238 và RFC 4226 (TOTP/HOTP) thuần Go chuẩn xác.
func validateTOTP(secret string, code string, windowSteps int) (bool, error) {
	cleanSecret := strings.ToUpper(strings.ReplaceAll(secret, " ", ""))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(cleanSecret)
	if err != nil {
		key, err = base32.StdEncoding.DecodeString(cleanSecret)
		if err != nil {
			return false, errors.New("secret key base32 không đúng định dạng")
		}
	}

	currentTimeStep := time.Now().Unix() / 30

	// Kiểm tra độ lệch trong khoảng [-windowSteps, +windowSteps]
	for i := -windowSteps; i <= windowSteps; i++ {
		step := currentTimeStep + int64(i)
		expectedCode := generateHOTP(key, step)
		if subtle.ConstantTimeCompare([]byte(expectedCode), []byte(code)) == 1 {
			return true, nil
		}
	}

	return false, nil
}

// generateHOTP tính toán mã 6 số từ HMAC-SHA1 theo RFC 4226.
func generateHOTP(key []byte, counter int64) string {
	counterBytes := make([]byte, 8)
	binary.BigEndian.PutUint64(counterBytes, uint64(counter))

	mac := hmac.New(sha1.New, key)
	mac.Write(counterBytes)
	hash := mac.Sum(nil)

	// Dynamic truncation
	offset := hash[len(hash)-1] & 0x0F
	truncatedHash := binary.BigEndian.Uint32(hash[offset:offset+4]) & 0x7FFFFFFF
	codeInt := truncatedHash % 1000000

	return fmt.Sprintf("%06d", codeInt)
}

// generateRecoveryCodes sinh các mã khôi phục ngẫu nhiên dạng WAF-XXXX-XXXX.
func generateRecoveryCodes(count int) []string {
	codes := make([]string, count)
	for i := 0; i < count; i++ {
		b := make([]byte, 4)
		rand.Read(b)
		codes[i] = fmt.Sprintf("WAF-%04X-%04X", binary.BigEndian.Uint16(b[0:2]), binary.BigEndian.Uint16(b[2:4]))
	}
	return codes
}
