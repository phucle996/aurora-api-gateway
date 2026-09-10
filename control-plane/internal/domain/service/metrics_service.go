package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// MetricsService định nghĩa port nghiệp vụ xử lý tích hợp, điều phối và truy vấn metrics/analytics.
type MetricsService interface {
	Close() error
	GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
	SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
	TestPrometheus(ctx context.Context, url string) (*entity.TestConnectionResult, error)
	GetNodeMetrics(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error)
	PushMetricPoint(nodeID string, pt entity.NodeMetricPoint)
	GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint
	RegisterConfigListener(listener func(cfg entity.MetricsIntegrationConfig))

	// Analytics & Key-Driven Query APIs
	QueryAnalytics(ctx context.Context, req entity.AnalyticsQueryRequest) (*entity.AnalyticsQueryResponse, error)
	QueryRaw(ctx context.Context, req entity.AnalyticsRawQueryRequest) (*entity.AnalyticsQueryResponse, error)
	GetCatalog(ctx context.Context) (*entity.MetricCatalogResponse, error)

	// Connection & Runtime Metadata Management
	GetConnectionStatus(ctx context.Context) (*entity.ConnectionStatusResponse, error)
	TestConnectionWithConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) (*entity.TestConnectionResult, error)
}
