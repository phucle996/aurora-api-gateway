package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// MetricsService định nghĩa port nghiệp vụ xử lý tích hợp và truy vấn metrics.
// Hỗ trợ cả 2 chế độ: Standalone (In-Memory Ring Buffer) và External Prometheus.
type MetricsService interface {
	Close() error
	GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error)
	SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error
	TestPrometheus(ctx context.Context, url string) (*entity.TestConnectionResult, error)
	GetNodeMetrics(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error)
	PushMetricPoint(nodeID string, pt entity.NodeMetricPoint)
	GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint
}
