package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	alertmanagerQueryTimeout  = 5 * time.Second
	alertmanagerActionTimeout = 8 * time.Second
)

// AlertmanagerHandler xử lý các API quản lý và cầu nối tích hợp với Alertmanager & Prometheus.
type AlertmanagerHandler struct {
	service port.AlertmanagerService
}

// NewAlertmanagerHandler khởi tạo instance AlertmanagerHandler.
func NewAlertmanagerHandler(service port.AlertmanagerService) *AlertmanagerHandler {
	return &AlertmanagerHandler{service: service}
}

// GetOverview trả về tình trạng kết nối tới Prometheus & Alertmanager cùng các thống kê cơ bản.
func (h *AlertmanagerHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerQueryTimeout)
	defer cancel()

	overview, err := h.service.GetOverview(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, overview)
}

// GetLiveRules trả về danh sách các alert rules hiện hữu từ Prometheus cùng trạng thái thời gian thực.
func (h *AlertmanagerHandler) GetLiveRules(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerQueryTimeout)
	defer cancel()

	rules, err := h.service.GetLiveRules(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"rules": rules,
		"total": len(rules),
	})
}

// GetFiringAlerts trả về danh sách các cảnh báo đang ở trạng thái FIRING.
func (h *AlertmanagerHandler) GetFiringAlerts(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerQueryTimeout)
	defer cancel()

	alerts, err := h.service.GetFiringAlerts(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"alerts": alerts,
		"total":  len(alerts),
	})
}

// GetSilences trả về danh sách các khoảng lặng (silences) được lưu trên Alertmanager.
func (h *AlertmanagerHandler) GetSilences(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerQueryTimeout)
	defer cancel()

	silences, err := h.service.GetSilences(ctx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"silences": silences,
		"total":    len(silences),
	})
}

// CreateSilence tạo một khoảng lặng mới trên Alertmanager để tạm dừng gửi cảnh báo.
func (h *AlertmanagerHandler) CreateSilence(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var req dto.CreateSilenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu tạo silence không hợp lệ: " + err.Error()})
		return
	}

	if len(req.Matchers) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cần chỉ định ít nhất 1 nhãn matcher cho silence"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerActionTimeout)
	defer cancel()

	item := entity.AlertmanagerSilenceItem{
		StartsAt:  req.StartsAt,
		EndsAt:    req.EndsAt,
		CreatedBy: strings.TrimSpace(req.CreatedBy),
		Comment:   strings.TrimSpace(req.Comment),
		Matchers:  req.Matchers,
	}
	if item.CreatedBy == "" {
		item.CreatedBy = "aurora-admin"
	}

	silenceID, err := h.service.CreateSilence(ctx, item)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "tạo khoảng lặng silence thành công",
		"silence_id": silenceID,
	})
}

// ExpireSilence kết thúc sớm hoặc xóa một silence trên Alertmanager.
func (h *AlertmanagerHandler) ExpireSilence(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	silenceID := strings.TrimSpace(c.Param("id"))
	if silenceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "silence_id không được để trống"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerActionTimeout)
	defer cancel()

	if err := h.service.ExpireSilence(ctx, silenceID); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "kết thúc silence thành công",
		"silence_id": silenceID,
	})
}

// GetConfig trả về cấu hình tích hợp Alertmanager & Prometheus hiện tại.
func (h *AlertmanagerHandler) GetConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerQueryTimeout)
	defer cancel()

	cfg, err := h.service.GetConfig(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, cfg)
}

// UpdateConfig cập nhật URL và trạng thái bật/tắt tích hợp Alertmanager & Prometheus.
func (h *AlertmanagerHandler) UpdateConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var req dto.UpdateAlertmanagerConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), alertmanagerActionTimeout)
	defer cancel()

	settings := entity.AlertmanagerSettings{
		Enabled:         *req.Enabled,
		AlertmanagerURL: strings.TrimSpace(req.AlertmanagerURL),
		PrometheusURL:   strings.TrimSpace(req.PrometheusURL),
	}

	if err := h.service.UpdateConfig(ctx, settings); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "cập nhật cấu hình tích hợp Alertmanager thành công",
	})
}
