package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// AnalyticsService định nghĩa port nghiệp vụ xử lý điều phối và truy vấn phân tích (Analytics Engine).
// Hoàn toàn là Read-Only Query Engine, không chứa Write Path hay in-memory buffer.
type AnalyticsService interface {
	Close() error

	// Query Engine APIs
	Query(ctx context.Context, req entity.AnalyticsQueryRequest) (*entity.AnalyticsQueryResponse, error)
	QueryRaw(ctx context.Context, req entity.AnalyticsRawQueryRequest) (*entity.AnalyticsQueryResponse, error)
	GetCatalog(ctx context.Context) (*entity.MetricCatalogResponse, error)

	// Connection & Runtime Metadata Management
	GetConnectionStatus(ctx context.Context) (*entity.ConnectionStatusResponse, error)
	SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
	SaveConnectionConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
	TestConnectionWithConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) (*entity.TestConnectionResult, error)

	// Notifications
	RegisterConfigListener(listener func(cfg entity.MetricsIntegrationConfig))
	GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
}
