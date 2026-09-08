package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// AuthHandler xử lý các yêu cầu HTTP liên quan đến xác thực người dùng (đăng nhập, lấy thông tin phiên làm việc, đăng xuất).
// Handler tiếp nhận HTTP Request, kiểm tra tính hợp lệ của dữ liệu đầu vào (Validation),
// gọi tầng Service để thực thi nghiệp vụ và trả về kết quả qua HTTP response kèm Cookie bảo mật.
type AuthHandler struct {
	service port.AuthService // Cầu nối sang tầng Service để xử lý logic xác thực và quản lý token JWT
}

// NewAuthHandler là hàm khởi tạo AuthHandler nhận vào đối tượng AuthService.
func NewAuthHandler(service port.AuthService) *AuthHandler {
	return &AuthHandler{service: service}
}

// ─── 1. Login (Xác thực thông tin tài khoản & Thiết lập phiên làm việc) ────────

// Login tiếp nhận thông tin tài khoản (username/password), xác thực qua tầng Service
// và cấp phát token JWT cùng Cookie HttpOnly để duy trì phiên đăng nhập của người dùng.
func (h *AuthHandler) Login(c *gin.Context) {
	// Bước 1: Thiết lập tiêu đề Cache-Control là 'no-store'
	// Yêu cầu trình duyệt và các proxy trung gian tuyệt đối không lưu lại dữ liệu nhạy cảm này vào bộ nhớ đệm
	c.Header("Cache-Control", "no-store")

	// Bước 2: Kiểm tra tiêu đề Content-Type — bắt buộc phải là application/json
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	// Bước 3: Giới hạn kích thước tối đa của request body là 64KB (65536 bytes)
	// Ngăn chặn các yêu cầu có dung lượng quá lớn làm cạn kiệt bộ nhớ máy chủ (tấn công DoS)
	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.LoginRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields() // Nghiêm cấm các trường dữ liệu lạ ngoài cấu trúc LoginRequest

	// Bước 4: Giải mã dữ liệu JSON vào struct req
	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body"})
		return
	}

	// Đảm bảo không có dữ liệu lạ bám theo sau đối tượng JSON chính
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	// Bước 5: Kiểm tra tính hợp lệ cơ bản của dữ liệu — không được để trống username hoặc password
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	// Bước 6: Gọi tầng Service để xác thực tài khoản và mật khẩu
	// Service sẽ tìm người dùng trong CSDL và kiểm tra mật khẩu qua thuật toán băm Argon2id
	result, err := h.service.Login(c.Request.Context(), entity.LoginInput{
		Username: req.Username,
		Password: req.Password,
	})
	if err != nil {
		// Nếu tên đăng nhập không tồn tại hoặc sai mật khẩu, trả về HTTP 401 Unauthorized
		if errors.Is(err, taxonomy.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}
		// Các lỗi hệ thống khác trả về HTTP 500 Internal Server Error
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Authentication failed"})
		return
	}

	// Bước 7: Cài đặt Cookie phiên đăng nhập (aurora_token) vào trình duyệt của người dùng:
	// - HttpOnly = true: Ngăn không cho mã JavaScript trên trang đọc Cookie này (chống đánh cắp token qua XSS).
	// - SameSite = Lax: Trình duyệt không gửi kèm Cookie khi người dùng bị chuyển hướng từ trang thứ ba (chống tấn công CSRF).
	// - Secure: Tự động bật cờ Secure nếu kết nối hiện tại sử dụng HTTPS (hoặc qua HTTPS reverse proxy).
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		result.Token,
		int(result.ExpiresIn), // Thời gian hiệu lực của Cookie tính bằng giây (mặc định 24 giờ = 86400 giây)
		"/",
		"",
		secure,
		true, // Cờ HttpOnly bảo vệ Cookie
	)

	// Bước 8: Trả về kết quả HTTP 200 OK chứa token JWT và thông tin tài khoản người dùng
	c.JSON(http.StatusOK, gin.H{
		"token":      result.Token,
		"token_type": result.TokenType,
		"expires_in": result.ExpiresIn,
		"user": gin.H{
			"id":       result.User.ID,
			"username": result.User.Username,
			"role":     result.User.Role,
		},
	})
}

// ─── 2. Me (Tra cứu thông tin phiên làm việc hiện tại) ─────────────────────────

// Me xác định danh tính của người dùng đang gửi yêu cầu và trả về thông tin tài khoản tương ứng.
func (h *AuthHandler) Me(c *gin.Context) {
	// Không lưu bộ đệm để tránh rò rỉ dữ liệu cá nhân
	c.Header("Cache-Control", "no-store")

	// Trường hợp 1: Nếu yêu cầu đã đi qua AuthMiddleware, thông tin người dùng đã được giải mã và lưu sẵn trong Context
	if userID, exists := c.Get("user_id"); exists {
		username, _ := c.Get("username")
		role, _ := c.Get("role")
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":       userID,
				"username": username,
				"role":     role,
			},
		})
		return
	}

	// Trường hợp 2: Trích xuất token trực tiếp từ tiêu đề HTTP hoặc từ Cookie
	// - Ưu tiên đọc từ tiêu đề "Authorization: Bearer <token>"
	// - Nếu không có, đọc từ Cookie mang tên "aurora_token"
	token := ""
	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := c.Cookie("aurora_token"); err == nil {
		token = cookie
	}

	// Nếu không tìm thấy token ở cả hai vị trí, từ chối yêu cầu với HTTP 401 Unauthorized
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid authorization"})
		return
	}

	// Bước 3: Xác thực chữ ký số và hạn sử dụng của token thông qua tầng Service
	claims, err := h.service.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Bước 4: Token hợp lệ, trả về thông tin định danh của người dùng từ Claims
	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":       claims.Subject,
			"username": claims.Username,
			"role":     claims.Role,
		},
	})
}

// ─── 3. Logout (Đăng xuất & Hủy phiên làm việc) ────────────────────────────────

// Logout xử lý hủy phiên đăng nhập hiện tại bằng cách xóa Cookie xác thực trên trình duyệt.
func (h *AuthHandler) Logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	// Xóa Cookie bằng cách gửi lại Cookie cùng tên với giá trị rỗng và thời gian sống là -1 (Max-Age < 0)
	// Khi nhận được giá trị này, trình duyệt sẽ lập tức xóa bỏ Cookie khỏi bộ nhớ lưu trữ
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		"",
		-1, // Hạn dùng âm ra lệnh cho trình duyệt xóa Cookie ngay lập tức
		"/",
		"",
		false,
		true, // HttpOnly
	)

	// Phản hồi thông báo đăng xuất thành công
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}
