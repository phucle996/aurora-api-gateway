package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"github.com/gin-gonic/gin"
)

const (
	analyticsQueryTimeout = 5 * time.Second
)

// AnalyticsHandler xử lý các API truy vấn số liệu đa chiều và cung cấp danh mục Metric Catalog.
type AnalyticsHandler struct {
	analyticsService service.AnalyticsService
}

// NewAnalyticsHandler khởi tạo handler mới cho Analytics.
func NewAnalyticsHandler(s service.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{analyticsService: s}
}

// Query thực thi truy vấn metrics theo key-driven contract.
// POST /api/v1/analytics/query
func (h *AnalyticsHandler) Query(c *gin.Context) {
	var req entity.AnalyticsQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu yêu cầu không hợp lệ: " + err.Error()})
		return
	}

	if len(req.Queries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "danh sách queries không được để trống"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), analyticsQueryTimeout)
	defer cancel()

	resp, err := h.analyticsService.Query(ctx, req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "truy vấn metrics quá thời gian quy định (timeout)"})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsDisabled) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "METRICS_DISABLED",
				"message": "Dịch vụ Metrics đang bị tắt. Vui lòng kích hoạt trong Settings -> Integrations.",
			})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "PROMETHEUS_UNAVAILABLE",
				"message": "Không thể kết nối máy chủ Prometheus. Vui lòng kiểm tra lại cấu hình mạng và URL.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lỗi truy vấn metrics: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// QueryRaw thực thi truy vấn trực tiếp bằng PromQL.
// POST /api/v1/analytics/query-raw
func (h *AnalyticsHandler) QueryRaw(c *gin.Context) {
	var req entity.AnalyticsRawQueryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu yêu cầu không hợp lệ: " + err.Error()})
		return
	}

	if req.Query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "câu truy vấn PromQL không được để trống"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), analyticsQueryTimeout)
	defer cancel()

	resp, err := h.analyticsService.QueryRaw(ctx, req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "truy vấn metrics quá thời gian quy định (timeout)"})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsDisabled) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "METRICS_DISABLED",
				"message": "Dịch vụ Metrics đang bị tắt.",
			})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "PROMETHEUS_UNAVAILABLE",
				"message": "Không thể kết nối máy chủ Prometheus.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lỗi thực thi PromQL: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// GetCatalog trả về danh mục các Metric Keys hỗ trợ và các Telemetry Sources.
// GET /api/v1/analytics/catalog
func (h *AnalyticsHandler) GetCatalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	catalogResp, err := h.analyticsService.GetCatalog(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lỗi trích xuất danh mục metrics: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, catalogResp)
}

// GetConnection lấy toàn bộ cấu hình kết nối, trạng thái extension và runtime metadata.
// GET /api/v1/analytics/connection
func (h *AnalyticsHandler) GetConnection(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	status, err := h.analyticsService.GetConnectionStatus(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lỗi đọc cấu hình kết nối: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, status)
}

// UpdateConnection lưu cấu hình kết nối Telemetry (URL, Job, Auth, TLS/mTLS).
// PUT /api/v1/analytics/connection
func (h *AnalyticsHandler) UpdateConnection(c *gin.Context) {
	var cfg entity.MetricsIntegrationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	if err := h.analyticsService.SaveConfig(ctx, cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "cập nhật cấu hình kết nối thành công"})
}

// TestConnection kiểm tra thử kết nối với payload cấu hình do Client gửi lên.
// POST /api/v1/analytics/connection/test
func (h *AnalyticsHandler) TestConnection(c *gin.Context) {
	var cfg entity.MetricsIntegrationConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	res, err := h.analyticsService.TestConnectionWithConfig(ctx, cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lỗi kiểm tra kết nối: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}
