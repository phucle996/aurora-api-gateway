package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// GetMetricsConfig xử lý HTTP GET /api/v1/settings/integrations/metrics:
// Lấy cấu hình tích hợp metrics hiện tại (Standalone vs External Prometheus).
func GetMetricsConfig(s port.MetricsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		cfg, err := s.GetConfig(ctx)
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
}

// UpdateMetricsConfig xử lý HTTP PUT /api/v1/settings/integrations/metrics:
// Cập nhật chế độ hoạt động giữa Lab/Standalone và Production Prometheus.
func UpdateMetricsConfig(s port.MetricsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Mode          string `json:"mode"`
			PrometheusURL string `json:"prometheus_url"`
			PrometheusJob string `json:"prometheus_job"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu JSON không hợp lệ: " + err.Error()})
			return
		}

		cfg := entity.MetricsIntegrationConfig{
			Mode:          req.Mode,
			PrometheusURL: req.PrometheusURL,
			PrometheusJob: req.PrometheusJob,
		}

		ctx := c.Request.Context()
		if err := s.SaveConfig(ctx, cfg); err != nil {
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
}

// TestPrometheusConnection xử lý HTTP POST /api/v1/settings/integrations/metrics/test:
// Kiểm tra khả năng kết nối tới Prometheus URL và đo độ trễ mạng.
func TestPrometheusConnection(s port.MetricsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			URL string `json:"url"`
		}

		if err := c.ShouldBindJSON(&req); err != nil || req.URL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Địa chỉ URL không hợp lệ hoặc để trống"})
			return
		}

		ctx := c.Request.Context()
		res, err := s.TestPrometheus(ctx, req.URL)
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
}

// GetNodeMetrics xử lý HTTP GET /api/v1/nodes/:id/metrics:
// Trả về chuỗi điểm đo Timeline cho node:
// - Nếu chế độ bị tắt: Trả về HTTP 503 kèm mã METRICS_DISABLED.
// - Nếu Prometheus sập: Trả về HTTP 503 kèm mã PROMETHEUS_UNAVAILABLE.
// - Nếu hợp lệ: Trả về HTTP 200 kèm danh sách điểm đo đã map tường minh sang gin.H.
func GetNodeMetrics(s port.MetricsService) gin.HandlerFunc {
	return func(c *gin.Context) {
		nodeID := c.Param("id")
		if nodeID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Mã node không được để trống"})
			return
		}

		ctx := c.Request.Context()
		points, err := s.GetNodeMetrics(ctx, nodeID)
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
				"rps":               pt.RPS,
				"cpuUsage":          pt.CPUUsage,
				"memoryUsage":       pt.MemoryUsage,
				"activeConnections": pt.ActiveConnections,
			})
		}

		c.JSON(http.StatusOK, response)
	}
}
