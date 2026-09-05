package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// SettingsRepository định nghĩa port truy xuất cấu hình tích hợp hệ thống trong SQLite.
type SettingsRepository interface {
	GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
	SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
}
