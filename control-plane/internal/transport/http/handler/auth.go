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

// AuthHandler là người gác cổng (Quầy tiếp nhận và kiểm soát định danh) của toàn bộ hệ thống WAF.
//
// [Góc nhìn kinh tế / quản trị]:
// Tương đương quầy kiểm soát hộ chiếu và phát thẻ căn cước tại sân bay hoặc tòa nhà ngân hàng:
// - Tiếp nhận thông tin đăng nhập của nhân viên/quản trị viên.
// - Kiểm tra tính hợp lệ của giấy tờ (username/mật khẩu).
// - Cấp phát "thẻ căn cước điện tử" (JWT token) kèm hạn sử dụng để người dùng ra vào hệ thống.
type AuthHandler struct {
	service port.AuthService // Cầu nối sang tầng xử lý nghiệp vụ xác thực (kiểm tra mật khẩu băm, ký số thẻ)
}

// NewAuthHandler khởi tạo bộ điều phối xác thực.
func NewAuthHandler(service port.AuthService) *AuthHandler {
	return &AuthHandler{service: service}
}

// ─── 1. Login (Xác thực thông tin & Cấp thẻ phiên làm việc) ───────────────────

// Login tiếp nhận yêu cầu đăng nhập, đối soát mật khẩu và cấp phát thẻ phiên làm việc.
//
// [Góc nhìn kinh tế / an toàn thông tin]:
// Giống như việc mở tài khoản giao dịch tại quầy:
// - Không lưu bộ nhớ đệm (No-Store): Ngăn trình duyệt lưu trộm thông tin tài chính/mật khẩu trên máy tính dùng chung.
// - Kiểm tra mẫu đơn (JSON only, tối đa 64KB): Tránh các hồ sơ rác làm nghẽn quầy phục vụ (chống tấn công DoS).
// - Cấp thẻ căn cước kép: Vừa trả về mã token trong thân phản hồi, vừa cấp thẻ niêm phong (HttpOnly Cookie)
//   vào két an toàn của trình duyệt để các đoạn mã độc không thể đánh cắp (chống tấn công đánh cắp phiên XSS/CSRF).
func (h *AuthHandler) Login(c *gin.Context) {
	// Bước 1: Yêu cầu trình duyệt không lưu bộ đệm nhằm bảo mật thông tin nhạy cảm
	c.Header("Cache-Control", "no-store")

	// Bước 2: Kiểm tra định dạng dữ liệu gửi lên — bắt buộc phải là đơn chuẩn JSON
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	// Bước 3: Giới hạn kích thước gói dữ liệu tối đa 64KB để phòng tránh tấn công làm nghẽn bộ nhớ
	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.LoginRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields() // Nghiêm cấm gửi thừa trường thông tin không rõ nguồn gốc

	// Bước 4: Giải mã nội dung đơn đăng nhập từ JSON vào struct DTO
	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body"})
		return
	}

	// Đảm bảo không có dữ liệu rác đính kèm phía sau JSON chính
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	// Bước 5: Kiểm tra tính đầy đủ của thông tin cơ bản: không được để trống tài khoản hoặc mật khẩu
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	// Bước 6: Chuyển dữ liệu sang tầng nghiệp vụ để đối soát mật khẩu với cơ sở dữ liệu
	result, err := h.service.Login(c.Request.Context(), entity.LoginInput{
		Username: req.Username,
		Password: req.Password,
	})
	if err != nil {
		// Nếu thông tin sai lệch: Trả về lỗi 401 Unauthorized (Không được phép truy cập)
		if errors.Is(err, taxonomy.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}
		// Sự cố máy chủ nội bộ
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Authentication failed"})
		return
	}

	// Bước 7: Cài đặt thẻ phiên (Cookie) vào trình duyệt của người dùng:
	// - HttpOnly = true: Tuyệt đối cấm JavaScript đọc trộm, phòng chống mã độc đánh cắp tài khoản (XSS).
	// - SameSite = Lax: Ngăn chặn các trang web lừa đảo lợi dụng phiên đăng nhập (CSRF).
	// - Secure: Tự động kích hoạt khi kết nối qua giao thức mã hóa HTTPS.
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		result.Token,
		int(result.ExpiresIn), // Thời hạn hiệu lực của thẻ (mặc định 24 giờ = 86400 giây)
		"/",
		"",
		secure,
		true, // HttpOnly
	)

	// Bước 8: Trả về phản hồi thành công inline bằng gin.H chứa token và thông tin nhận diện người dùng
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

// ─── 2. Me (Tra cứu thẻ căn cước & Phiên làm việc hiện tại) ───────────────────

// Me xác minh danh tính người gửi yêu cầu và trả về thông tin hồ sơ tài khoản hiện tại.
//
// [Góc nhìn kinh tế / quản trị]:
// Giống như kiểm tra thẻ nhân viên khi đi qua cổng an ninh:
// - Kiểm tra xem người này có xuất trình thẻ phiên (qua Header Bearer hoặc Cookie trình duyệt) hay không.
// - Thẩm định chữ ký số xem thẻ có bị làm giả hoặc đã hết hạn (quá 24h) hay chưa.
// - Đọc ra quyền hạn (Role: Quản trị viên hay Kỹ thuật viên) để cấp phép sử dụng tài nguyên.
func (h *AuthHandler) Me(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	// Ưu tiên 1: Đọc thông tin đã được cổng gác an ninh (Middleware) thẩm định và lưu sẵn vào Context
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

	// Ưu tiên 2: Tự động trích xuất chuỗi thẻ căn cước (Token):
	// Tìm ở tiêu đề HTTP "Authorization: Bearer <token>" hoặc trong Cookie "aurora_token"
	token := ""
	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := c.Cookie("aurora_token"); err == nil {
		token = cookie
	}

	// Nếu không tìm thấy thẻ ở bất kỳ đâu -> Từ chối yêu cầu (401 Unauthorized)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid authorization"})
		return
	}

	// Bước 3: Thẩm định chữ ký số và hạn dùng của token tại tầng dịch vụ nghiệp vụ
	claims, err := h.service.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Bước 4: Trả về thông tin hồ sơ người dùng hợp lệ
	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":       claims.Subject,
			"username": claims.Username,
			"role":     claims.Role,
		},
	})
}

// ─── 3. Logout (Hủy phiên làm việc & Thu hồi thẻ căn cước) ───────────────────

// Logout hủy phiên làm việc hiện tại của người dùng.
//
// [Góc nhìn kinh tế / quản trị]:
// Giống như thủ tục trả thẻ ra vào và đóng sổ phiên giao dịch:
// - Đặt thời gian sống của Cookie thành giá trị âm (-1), ra lệnh cho trình duyệt lập tức xóa thẻ khỏi bộ nhớ.
// - Ngăn chặn người khác sử dụng lại máy tính này để truy cập trái phép vào tài nguyên an ninh WAF.
func (h *AuthHandler) Logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	// Thu hồi thẻ bằng cách ghi đè Cookie với hạn dùng -1 (Trình duyệt sẽ lập tức xóa bỏ)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		"",
		-1, // Hạn dùng âm -> Xóa Cookie ngay lập tức
		"/",
		"",
		false,
		true, // HttpOnly
	)

	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}
