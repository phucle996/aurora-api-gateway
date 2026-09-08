package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"github.com/gin-gonic/gin"
)

const (
	metricsQueryTimeout  = 5 * time.Second  // Dành cho GetConfig và GetNodeMetrics
	metricsConfigTimeout = 5 * time.Second  // Dành cho UpdateConfig lưu cấu hình vào DB
	metricsTestTimeout   = 10 * time.Second // Dành cho TestConnection kiểm tra kết nối Prometheus từ xa
)

// MetricsHandler handles metrics integration settings and Prometheus connectivity.
type MetricsHandler struct {
	service port.MetricsService
}

// NewMetricsHandler creates a new MetricsHandler instance.
func NewMetricsHandler(s port.MetricsService) *MetricsHandler {
	return &MetricsHandler{service: s}
}

// GetConfig returns the current metrics integration configuration.
func (h *MetricsHandler) GetConfig(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), metricsQueryTimeout)
	defer cancel()

	cfg, err := h.service.GetConfig(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "metrics config query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query metrics config: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"mode":           cfg.Mode,
		"prometheus_url": cfg.PrometheusURL,
		"prometheus_job": cfg.PrometheusJob,
		"updated_at":     cfg.UpdatedAt,
	})
}

// UpdateConfig updates the metrics integration mode and Prometheus connection details.
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON data: " + err.Error()})
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), metricsConfigTimeout)
	defer cancel()

	if err := h.service.SaveConfig(ctx, cfg); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "save metrics config timed out"})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "metrics integration config updated successfully",
		"mode":           cfg.Mode,
		"prometheus_url": cfg.PrometheusURL,
		"prometheus_job": cfg.PrometheusJob,
	})
}

// TestConnection tests connectivity to a remote Prometheus server.
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON data: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	if strings.TrimSpace(req.URL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "URL cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), metricsTestTimeout)
	defer cancel()

	res, err := h.service.TestPrometheus(ctx, req.URL)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Prometheus connection test timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    res.Success,
		"message":    res.Message,
		"latency_ms": res.LatencyMs,
	})
}

// GetNodeMetrics returns timeline metrics for a specific node.
func (h *MetricsHandler) GetNodeMetrics(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), metricsQueryTimeout)
	defer cancel()

	points, err := h.service.GetNodeMetrics(ctx, nodeID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "node metrics query timed out"})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsDisabled) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "METRICS_DISABLED",
				"message": "Metrics collection is disabled. Please enable it in Settings -> Integrations.",
			})
			return
		}
		if errors.Is(err, taxonomy.ErrMetricsUnavailable) {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":   "PROMETHEUS_UNAVAILABLE",
				"message": "Unable to connect to Prometheus server. Please check the connection configuration in Settings.",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to retrieve metrics: " + err.Error()})
		return
	}
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
