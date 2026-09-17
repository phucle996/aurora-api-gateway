package repo

import (
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
	"context"
)

// AnalyticsRepository định nghĩa port truy xuất cấu hình tích hợp Telemetry và dữ liệu phân tích.
type AnalyticsRepository interface {
	GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
	SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
}
