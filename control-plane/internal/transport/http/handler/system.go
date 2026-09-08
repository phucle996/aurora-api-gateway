package handler

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
)

var appStartTime = time.Now()

// SystemHandler cung cấp thông tin hệ thống thực tế cho Settings > General.
type SystemHandler struct {
	db         *sql.DB
	sqlitePath string
	version    string
	buildTime  string
}

func NewSystemHandler(db *sql.DB, sqlitePath, version, buildTime string) *SystemHandler {
	if version == "" {
		version = "v1.0.0-rc1"
	}
	if buildTime == "" {
		buildTime = "2026-09-07 08:30:00"
	}
	return &SystemHandler{
		db:         db,
		sqlitePath: sqlitePath,
		version:    version,
		buildTime:  buildTime,
	}
}

type SystemInfoResponse struct {
	Product              string `json:"product"`
	Version              string `json:"version"`
	Build                string `json:"build"`
	GoVersion            string `json:"go_version"`
	UptimeSeconds        int64  `json:"uptime_seconds"`
	UptimeFormatted      string `json:"uptime_formatted"`
	Architecture         string `json:"architecture"`
	StatePersistence     string `json:"state_persistence"`
	DatabasePath         string `json:"database_path"`
	DatabaseSizeBytes    int64  `json:"database_size_bytes"`
	DatabaseSizeFormat   string `json:"database_size_formatted"`
	NodesTotal           int    `json:"nodes_total"`
	NodesReady           int    `json:"nodes_ready"`
	NodesSummary         string `json:"nodes_summary"`
	MemoryAllocBytes     uint64 `json:"memory_alloc_bytes"`
	MemoryAllocFormatted string `json:"memory_alloc_formatted"`
}

func (h *SystemHandler) Info(c *gin.Context) {
	uptime := time.Since(appStartTime)
	uptimeSec := int64(uptime.Seconds())
	uptimeStr := formatDuration(uptime)

	var dbSize int64
	var dbSizeStr = "0 KB"
	if fi, err := os.Stat(h.sqlitePath); err == nil {
		dbSize = fi.Size()
		dbSizeStr = formatBytes(uint64(dbSize))
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	memStr := formatBytes(m.Alloc)

	var nodesTotal, nodesReady int
	if h.db != nil {
		_ = h.db.QueryRowContext(c.Request.Context(), "SELECT COUNT(*) FROM cluster_nodes;").Scan(&nodesTotal)
		_ = h.db.QueryRowContext(c.Request.Context(), "SELECT COUNT(*) FROM cluster_nodes WHERE status IN ('Ready', 'healthy', 'online');").Scan(&nodesReady)
	}

	nodesSummary := fmt.Sprintf("%d / %d Nodes Ready", nodesReady, nodesTotal)
	if nodesTotal == 0 {
		nodesSummary = "Standalone (0 Nodes)"
	}

	statePersistence := "SQLite"

	res := SystemInfoResponse{
		Product:              "AURORA WAF",
		Version:              h.version,
		Build:                fmt.Sprintf("%s · %s", h.buildTime, runtime.Version()),
		GoVersion:            runtime.Version(),
		UptimeSeconds:        uptimeSec,
		UptimeFormatted:      uptimeStr,
		Architecture:         fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		StatePersistence:     statePersistence,
		DatabasePath:         h.sqlitePath,
		DatabaseSizeBytes:    dbSize,
		DatabaseSizeFormat:   dbSizeStr,
		NodesTotal:           nodesTotal,
		NodesReady:           nodesReady,
		NodesSummary:         nodesSummary,
		MemoryAllocBytes:     m.Alloc,
		MemoryAllocFormatted: memStr,
	}

	c.JSON(http.StatusOK, res)
}

func formatDuration(d time.Duration) string {
	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60

	if days > 0 {
		return fmt.Sprintf("%d days %d hours", days, hours)
	}
	if hours > 0 {
		return fmt.Sprintf("%d hours %d mins", hours, minutes)
	}
	if minutes > 0 {
		return fmt.Sprintf("%d mins %d secs", minutes, seconds)
	}
	return fmt.Sprintf("%d secs", seconds)
}

func formatBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
