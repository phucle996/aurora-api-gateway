package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// RateLimitRepository định nghĩa cổng lưu trữ cho Rate Limit Rules workflow.
type RateLimitRepository interface {
	Create(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error)
	Update(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error)
	List(ctx context.Context, query entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error)
	GetByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error)
	Delete(ctx context.Context, id int64) error
	GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error)
	GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error)
	BatchUpsertMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error
}
