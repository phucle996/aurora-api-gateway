package handler

import (
	"net/http"

	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

// SystemHandler cung cấp thông tin hệ thống cho Settings > General.
type SystemHandler struct {
	service port.SystemService
}

// NewSystemHandler khởi tạo SystemHandler với SystemService.
func NewSystemHandler(service port.SystemService) *SystemHandler {
	return &SystemHandler{service: service}
}

// Info xử lý GET /api/v1/system/info: Trả về thông tin runtime hệ thống dưới dạng gin.H inline.
func (h *SystemHandler) Info(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	info, err := h.service.GetSystemInfo(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Không thể lấy thông tin hệ thống: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"product":                 info.Product,
		"version":                 info.Version,
		"build":                   info.Build,
		"go_version":              info.GoVersion,
		"uptime_seconds":          info.UptimeSeconds,
		"uptime_formatted":        info.UptimeFormatted,
		"architecture":            info.Architecture,
		"state_persistence":       info.StatePersistence,
		"database_path":           info.DatabasePath,
		"database_size_bytes":     info.DatabaseSizeBytes,
		"database_size_formatted": info.DatabaseSizeFormat,
		"nodes_total":             info.NodesTotal,
		"nodes_ready":             info.NodesReady,
		"nodes_summary":           info.NodesSummary,
		"memory_alloc_bytes":      info.MemoryAllocBytes,
		"memory_alloc_formatted":  info.MemoryAllocFormatted,
	})
}
