package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
)

// RateLimitService triển khai các nghiệp vụ Rate Limit Rule theo port.RateLimitService.
type RateLimitService struct {
	repo     repo.RateLimitRepository
	provider provider.RateLimitMetricsProvider
}

// NewRateLimitService khởi tạo service với repository và metrics provider tương ứng.
func NewRateLimitService(r repo.RateLimitRepository, p provider.RateLimitMetricsProvider) port.RateLimitService {
	if p == nil {
		p = provider.NewStandaloneRateLimitProvider(r)
	}
	return &RateLimitService{
		repo:     r,
		provider: p,
	}
}

// CreateRateLimitRule tạo mới rule rate limit mà không lặp lại validate từ handler.
func (s *RateLimitService) CreateRateLimitRule(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return s.repo.Create(ctx, cmd)
}

// UpdateRateLimitRule cập nhật rule rate limit.
func (s *RateLimitService) UpdateRateLimitRule(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return s.repo.Update(ctx, cmd)
}

// ListRateLimitRules truy vấn danh sách rate limit rules.
func (s *RateLimitService) ListRateLimitRules(ctx context.Context, query entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error) {
	return s.repo.List(ctx, query)
}

// GetRateLimitRuleByID lấy chi tiết rule theo ID.
func (s *RateLimitService) GetRateLimitRuleByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error) {
	return s.repo.GetByID(ctx, id)
}

// DeleteRateLimitRule xóa rule theo ID.
func (s *RateLimitService) DeleteRateLimitRule(ctx context.Context, id int64) error {
	return s.repo.Delete(ctx, id)
}

// GetStats lấy tổng quan số liệu thống kê Rate Limiting từ provider.
func (s *RateLimitService) GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error) {
	summary, err := s.provider.GetStats(ctx)
	if err != nil {
		return nil, err
	}
	summary.Mode = s.provider.Mode()
	return summary, nil
}

// GetMetrics lấy dữ liệu biểu đồ và top endpoints theo range và sort từ provider.
func (s *RateLimitService) GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error) {
	result, err := s.provider.GetMetrics(ctx, timeRange, sortBy)
	if err != nil {
		return nil, err
	}
	result.Mode = s.provider.Mode()
	return result, nil
}

// RecordMetrics lưu các mẫu metrics theo giờ và endpoint thu thập được.
func (s *RateLimitService) RecordMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error {
	return s.repo.BatchUpsertMetrics(ctx, hourly, endpoints)
}
