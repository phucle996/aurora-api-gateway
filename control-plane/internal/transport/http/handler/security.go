package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// SecurityHandler xử lý các yêu cầu HTTP liên quan đến cấu hình bảo mật hệ thống, 2FA và đổi mật khẩu.
type SecurityHandler struct {
	service port.SecurityService
}

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

// GetOverview trả về danh sách toàn bộ auth providers, trạng thái 2FA và mật khẩu.
func (h *SecurityHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	overview, err := h.service.GetOverview(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, overview)
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

	if err := h.service.UpdateProvider(c.Request.Context(), id, req.Enabled, req.ConfigJSON); err != nil {
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

	out, err := h.service.Init2FA(c.Request.Context(), userID, username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, out)
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

	out, err := h.service.Verify2FA(c.Request.Context(), userID, entity.Verify2FACommand{
		Secret: req.Secret,
		Code:   req.Code,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, out)
}

// Disable2FA tắt 2FA.
func (h *SecurityHandler) Disable2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	if err := h.service.Disable2FA(c.Request.Context(), userID); err != nil {
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

	err := h.service.ChangePassword(c.Request.Context(), userID, entity.ChangePasswordCommand{
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Đổi mật khẩu thành công"})
}
