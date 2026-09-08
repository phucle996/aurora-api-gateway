package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

const (
	systemQueryTimeout = 5 * time.Second // Dành cho Info truy vấn phần cứng, SQLite và cluster state
)

// SystemHandler provides system runtime, persistence, and host resource information.
type SystemHandler struct {
	service port.SystemService
}

// NewSystemHandler creates a new SystemHandler instance.
func NewSystemHandler(service port.SystemService) *SystemHandler {
	return &SystemHandler{service: service}
}

// Info returns system version, uptime, database size, and node counts.
func (h *SystemHandler) Info(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), systemQueryTimeout)
	defer cancel()

	info, err := h.service.GetSystemInfo(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "system info query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get system info: " + err.Error()})
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
