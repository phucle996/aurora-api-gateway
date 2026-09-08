package handler

import (
	"net/http"
	"strings"

	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// NotificationHandler xử lý các yêu cầu HTTP liên quan đến cấu hình kênh thông báo và kiểm thử gửi tin.
type NotificationHandler struct {
	service port.NotificationService
}

// NewNotificationHandler khởi tạo handler cho thông báo.
func NewNotificationHandler(service port.NotificationService) *NotificationHandler {
	return &NotificationHandler{service: service}
}

// GetOverview trả về danh sách các kênh thông báo và các quy tắc kích hoạt cảnh báo.
func (h *NotificationHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	overview, err := h.service.GetOverview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, overview)
}

// UpdateChannel cập nhật trạng thái bật/tắt và cấu hình của một kênh thông báo.
func (h *NotificationHandler) UpdateChannel(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.ToLower(c.Param("id"))

	var req dto.UpdateNotificationChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	if err := h.service.UpdateChannel(c.Request.Context(), id, req.Enabled, req.ConfigJSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Cập nhật kênh thông báo thành công",
		"id":      id,
		"enabled": req.Enabled,
	})
}

// UpdateRule cập nhật trạng thái bật/tắt của một quy tắc cảnh báo.
func (h *NotificationHandler) UpdateRule(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.TrimSpace(c.Param("id"))

	var req dto.UpdateNotificationRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu cập nhật quy tắc không hợp lệ: " + err.Error()})
		return
	}

	if err := h.service.UpdateRule(c.Request.Context(), id, req.Enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Cập nhật quy tắc cảnh báo thành công",
		"id":      id,
		"enabled": req.Enabled,
	})
}

// TestChannel thực hiện kiểm thử gửi thông báo tới kênh cụ thể.
func (h *NotificationHandler) TestChannel(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.ToLower(c.Param("id"))

	result, err := h.service.TestChannel(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
