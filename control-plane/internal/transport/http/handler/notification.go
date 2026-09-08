package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// Thời gian chờ tối đa cho các tác vụ Notification
const (
	notificationQueryTimeout  = 5 * time.Second  // Dành cho GetOverview truy vấn SQLite
	notificationActionTimeout = 10 * time.Second // Dành cho UpdateChannel, UpdateRule, TestChannel
)

// NotificationHandler xử lý các yêu cầu HTTP liên quan đến cấu hình kênh thông báo (Telegram, Discord, Slack, Webhook) và kiểm thử gửi tin.
type NotificationHandler struct {
	service port.NotificationService
}

// NewNotificationHandler khởi tạo handler cho thông báo.
func NewNotificationHandler(service port.NotificationService) *NotificationHandler {
	return &NotificationHandler{service: service}
}

// GetOverview trả về danh sách các kênh thông báo và các quy tắc kích hoạt cảnh báo dưới dạng gin.H inline.
func (h *NotificationHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), notificationQueryTimeout)
	defer cancel()

	overview, err := h.service.GetOverview(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn danh sách thông báo đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	channelsList := make([]gin.H, len(overview.Channels))
	for i, ch := range overview.Channels {
		channelsList[i] = gin.H{
			"id":                ch.ID,
			"name":              ch.Name,
			"description":       ch.Description,
			"enabled":           ch.Enabled,
			"config_json":       ch.ConfigJSON,
			"last_tested_at":    ch.LastTestedAt,
			"last_test_status":  ch.LastTestStatus,
			"last_test_message": ch.LastTestMessage,
			"updated_at":        ch.UpdatedAt,
		}
	}

	rulesList := make([]gin.H, len(overview.Rules))
	for i, r := range overview.Rules {
		rulesList[i] = gin.H{
			"id":          r.ID,
			"name":        r.Name,
			"description": r.Description,
			"severity":    r.Severity,
			"enabled":     r.Enabled,
			"updated_at":  r.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"channels": channelsList,
		"rules":    rulesList,
	})
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), notificationActionTimeout)
	defer cancel()

	if err := h.service.UpdateChannel(ctx, id, req.Enabled, req.ConfigJSON); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Cập nhật kênh thông báo đã hết thời gian chờ"})
			return
		}
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), notificationActionTimeout)
	defer cancel()

	if err := h.service.UpdateRule(ctx, id, req.Enabled); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Cập nhật quy tắc cảnh báo đã hết thời gian chờ"})
			return
		}
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), notificationActionTimeout)
	defer cancel()

	result, err := h.service.TestChannel(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Kiểm thử kênh thông báo đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    result.Success,
		"message":    result.Message,
		"latency_ms": result.LatencyMs,
	})
}
