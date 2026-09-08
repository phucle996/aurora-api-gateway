package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// RateLimitService định nghĩa cổng nghiệp vụ cho Rate Limit Rules workflow.
type RateLimitService interface {
	CreateRateLimitRule(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error)
	UpdateRateLimitRule(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error)
	ListRateLimitRules(ctx context.Context, query entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error)
	GetRateLimitRuleByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error)
	DeleteRateLimitRule(ctx context.Context, id int64) error
	GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error)
	GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error)
	RecordMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error
}
