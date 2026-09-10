package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// AnalyticsRepository định nghĩa port truy xuất cấu hình tích hợp Telemetry và dữ liệu phân tích.
type AnalyticsRepository interface {
	GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
	SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
}

// SettingsRepository giữ type alias cho AnalyticsRepository để bảo toàn khả năng tương thích.
type SettingsRepository = AnalyticsRepository
