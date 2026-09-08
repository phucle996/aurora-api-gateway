package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// Thời gian chờ tối đa cho các tác vụ Security & 2FA
const (
	securityQueryTimeout  = 5 * time.Second  // Dành cho GetOverview truy vấn cấu hình bảo mật
	securityActionTimeout = 10 * time.Second // Dành cho UpdateProvider, Init2FA, Verify2FA, Disable2FA, ChangePassword
)

// SecurityHandler xử lý các yêu cầu HTTP liên quan đến cấu hình bảo mật hệ thống, 2FA và đổi mật khẩu.
type SecurityHandler struct {
	service port.SecurityService
}

// NewSecurityHandler khởi tạo SecurityHandler với SecurityService.
func NewSecurityHandler(service port.SecurityService) *SecurityHandler {
	return &SecurityHandler{service: service}
}

// helper lấy user_id từ gin context (hoặc fallback admin)
func getUserIDAndName(c *gin.Context) (string, string) {
	userID := "usr_admin_01"
	username := "admin"
	if uid, exists := c.Get("user_id"); exists {
		if s, ok := uid.(string); ok && s != "" && s != "operator" {
			userID = s
		}
	}
	if uname, exists := c.Get("username"); exists {
		if s, ok := uname.(string); ok && s != "" && s != "operator" {
			username = s
		}
	}
	return userID, username
}

// GetOverview trả về danh sách toàn bộ auth providers, trạng thái 2FA và mật khẩu dưới dạng gin.H inline.
func (h *SecurityHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityQueryTimeout)
	defer cancel()

	overview, err := h.service.GetOverview(ctx, userID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn thông tin bảo mật đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	providersList := make([]gin.H, len(overview.AuthProviders))
	for i, p := range overview.AuthProviders {
		providersList[i] = gin.H{
			"id":          p.ID,
			"name":        p.Name,
			"description": p.Description,
			"enabled":     p.Enabled,
			"config_json": p.ConfigJSON,
			"updated_at":  p.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"auth_providers": providersList,
		"two_factor": gin.H{
			"enabled":       overview.TwoFactor.Enabled,
			"configured":    overview.TwoFactor.Configured,
			"configured_at": overview.TwoFactor.ConfiguredAt,
		},
		"admin_username":        overview.AdminUsername,
		"password_last_updated": overview.PasswordLastUpdated,
	})
}

// UpdateProvider cập nhật trạng thái bật/tắt và cấu hình của một provider.
func (h *SecurityHandler) UpdateProvider(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.ToLower(c.Param("id"))

	var req dto.UpdateAuthProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	if err := h.service.UpdateProvider(ctx, id, req.Enabled, req.ConfigJSON); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Cập nhật phương thức xác thực đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Cập nhật phương thức xác thực thành công",
		"id":      id,
		"enabled": req.Enabled,
	})
}

// Init2FA khởi tạo thiết lập 2FA, trả về secret base32 và URL otpauth.
func (h *SecurityHandler) Init2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, username := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	out, err := h.service.Init2FA(ctx, userID, username)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Khởi tạo 2FA đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"secret":      out.Secret,
		"otpauth_url": out.OtpAuthURL,
		"qr_svg":      out.QrSVG,
	})
}

// Verify2FA xác thực mã 6 số và kích hoạt 2FA.
func (h *SecurityHandler) Verify2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	var req dto.Verify2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vui lòng nhập đầy đủ secret và mã xác thực 6 số"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	out, err := h.service.Verify2FA(ctx, userID, entity.Verify2FACommand{
		Secret: req.Secret,
		Code:   req.Code,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Xác thực 2FA đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":        out.Enabled,
		"recovery_codes": out.RecoveryCodes,
	})
}

// Disable2FA tắt 2FA.
func (h *SecurityHandler) Disable2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	if err := h.service.Disable2FA(ctx, userID); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Tắt xác thực 2FA đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Đã tắt xác thực hai yếu tố (2FA)"})
}

// ChangePassword cập nhật mật khẩu đăng nhập của người dùng.
func (h *SecurityHandler) ChangePassword(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	var req dto.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mật khẩu mới phải có ít nhất 8 ký tự"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	err := h.service.ChangePassword(ctx, userID, entity.ChangePasswordCommand{
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Đổi mật khẩu đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Đổi mật khẩu thành công"})
}
