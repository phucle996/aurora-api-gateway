package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"github.com/gin-gonic/gin"
)

// MetricsHandler bao đóng các HTTP endpoint xử lý cho Settings & Telemetry Integrations.
type MetricsHandler struct {
	service port.MetricsService
}

// NewMetricsHandler khởi tạo MetricsHandler với service tương ứng.
func NewMetricsHandler(s port.MetricsService) *MetricsHandler {
	return &MetricsHandler{service: s}
}

// GetConfig xử lý HTTP GET /api/v1/settings/integrations/metrics:
// Lấy cấu hình tích hợp metrics hiện tại (Standalone vs External Prometheus).
func (h *MetricsHandler) GetConfig(c *gin.Context) {
	ctx := c.Request.Context()
	cfg, err := h.service.GetConfig(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn cấu hình metrics: " + err.Error()})
		return
	}

	// Map tường minh sang gin.H để đảm bảo hợp đồng schema JSON cố định
	c.JSON(http.StatusOK, gin.H{
		"mode":           cfg.Mode,
		"prometheus_url": cfg.PrometheusURL,
		"prometheus_job": cfg.PrometheusJob,
		"updated_at":     cfg.UpdatedAt,
	})
}

// UpdateConfig xử lý HTTP PUT /api/v1/settings/integrations/metrics:
// Cập nhật chế độ hoạt động giữa Lab/Standalone và Production Prometheus.
func (h *MetricsHandler) UpdateConfig(c *gin.Context) {
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req struct {
		Mode          string `json:"mode"`
		PrometheusURL string `json:"prometheus_url"`
		PrometheusJob string `json:"prometheus_job"`
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu JSON không hợp lệ: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	cfg := entity.MetricsIntegrationConfig{
		Mode:          req.Mode,
		PrometheusURL: req.PrometheusURL,
		PrometheusJob: req.PrometheusJob,
	}

	ctx := c.Request.Context()
	if err := h.service.SaveConfig(ctx, cfg); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Cập nhật cấu hình tích hợp metrics thành công",
		"mode":           cfg.Mode,
		"prometheus_url": cfg.PrometheusURL,
		"prometheus_job": cfg.PrometheusJob,
	})
}

// TestConnection xử lý HTTP POST /api/v1/settings/integrations/metrics/test:
// Kiểm tra khả năng kết nối tới Prometheus URL và đo độ trễ mạng.
func (h *MetricsHandler) TestConnection(c *gin.Context) {
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req struct {
		URL string `json:"url"`
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu JSON không hợp lệ: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	if strings.TrimSpace(req.URL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Địa chỉ URL không được để trống"})
		return
	}

	ctx := c.Request.Context()
	res, err := h.service.TestPrometheus(ctx, req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    res.Success,
		"message":    res.Message,
		"latency_ms": res.LatencyMs,
	})
}

// GetNodeMetrics xử lý HTTP GET /api/v1/nodes/:id/metrics:
// Trả về chuỗi điểm đo Timeline cho node:
// - Nếu chế độ bị tắt: Trả về HTTP 503 kèm mã METRICS_DISABLED.
// - Nếu Prometheus sập: Trả về HTTP 503 kèm mã PROMETHEUS_UNAVAILABLE.
// - Nếu hợp lệ: Trả về HTTP 200 kèm danh sách điểm đo đã map tường minh sang gin.H.
func (h *MetricsHandler) GetNodeMetrics(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã node không được để trống"})
		return
	}

	ctx := c.Request.Context()
	points, err := h.service.GetNodeMetrics(ctx, nodeID)
	if err != nil {
		if errors.Is(err, taxonomy.ErrMetricsDisabled) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "METRICS_DISABLED",
				"message": "Nguồn thu thập metrics đang ở trạng thái tắt. Vui lòng kích hoạt trong Cài đặt -> Tích hợp.",
			})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "PROMETHEUS_UNAVAILABLE",
				"message": "Không thể kết nối tới máy chủ Prometheus. Vui lòng kiểm tra lại cấu hình kết nối trong Cài đặt.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy xuất metrics: " + err.Error()})
		return
	}

	// Map tường minh từng điểm đo sang gin.H
	response := make([]gin.H, 0, len(points))
	for _, pt := range points {
		response = append(response, gin.H{
			"timestamp":         pt.Timestamp,
			"timeLabel":         pt.TimeLabel,
			"metricsScope":      pt.MetricsScope,
			"rps":               pt.RPS,
			"cpuUsage":          pt.CPUUsage,
			"memoryUsage":       pt.MemoryUsage,
			"activeConnections": pt.ActiveConnections,
		})
	}

	c.JSON(http.StatusOK, response)
}
