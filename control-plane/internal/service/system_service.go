package service

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"time"

	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

// SystemService triển khai port.SystemService.
type SystemService struct {
	repo      repo.SystemRepository
	cfg       config.Config
	startedAt time.Time
}

// NewSystemService khởi tạo service thu thập thông tin hệ thống.
func NewSystemService(r repo.SystemRepository, cfg config.Config) port.SystemService {
	if cfg.Version == "" {
		cfg.Version = config.DefaultVersion
	}
	if cfg.BuildTime == "" {
		cfg.BuildTime = config.DefaultBuildTime
	}
	return &SystemService{
		repo:      r,
		cfg:       cfg,
		startedAt: time.Now(),
	}
}

// GetSystemInfo tổng hợp toàn bộ thông số runtime, bộ nhớ, kích thước database và trạng thái node.
func (s *SystemService) GetSystemInfo(ctx context.Context) (*entity.SystemInfo, error) {
	uptime := time.Since(s.startedAt)
	uptimeSec := int64(uptime.Seconds())
	uptimeStr := formatDuration(uptime)

	var dbSize int64
	var dbSizeStr = "0 KB"
	if fi, err := os.Stat(s.cfg.SQLitePath); err == nil {
		dbSize = fi.Size()
		dbSizeStr = formatBytes(uint64(dbSize))
	}

	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	memStr := formatBytes(m.Alloc)

	nodesTotal, nodesReady, _ := s.repo.GetNodeCounts(ctx)
	nodesSummary := "Stateless Fleet (Pull Sync)"

	return &entity.SystemInfo{
		Product:              "AURORA API GATEWAY",
		Version:              s.cfg.Version,
		Build:                fmt.Sprintf("%s · %s", s.cfg.BuildTime, runtime.Version()),
		GoVersion:            runtime.Version(),
		UptimeSeconds:        uptimeSec,
		UptimeFormatted:      uptimeStr,
		Architecture:         fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
		StatePersistence:     "SQLite",
		DatabasePath:         s.cfg.SQLitePath,
		DatabaseSizeBytes:    dbSize,
		DatabaseSizeFormat:   dbSizeStr,
		NodesTotal:           nodesTotal,
		NodesReady:           nodesReady,
		NodesSummary:         nodesSummary,
		MemoryAllocBytes:     m.Alloc,
		MemoryAllocFormatted: memStr,
	}, nil
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
