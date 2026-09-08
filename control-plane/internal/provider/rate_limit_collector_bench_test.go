package provider_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/provider"
)

type dummyRateLimitService struct{}

func (d *dummyRateLimitService) CreateRateLimitRule(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (d *dummyRateLimitService) UpdateRateLimitRule(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (d *dummyRateLimitService) ListRateLimitRules(ctx context.Context, query entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error) {
	return nil, nil
}
func (d *dummyRateLimitService) GetRateLimitRuleByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (d *dummyRateLimitService) DeleteRateLimitRule(ctx context.Context, id int64) error {
	return nil
}
func (d *dummyRateLimitService) GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error) {
	return nil, nil
}
func (d *dummyRateLimitService) GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error) {
	return nil, nil
}
func (d *dummyRateLimitService) RecordMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error {
	return nil
}

func BenchmarkRateLimitCollector_20MillionRequests(b *testing.B) {
	collector := provider.NewRateLimitCollector(&dummyRateLimitService{}, "")
	const totalRequests = 20_000_000
	const numWorkers = 50
	const reqsPerWorker = totalRequests / numWorkers

	endpoints := []string{
		"/api/v1/login",
		"/api/v1/checkout",
		"/api/v1/users",
		"/api/v1/search",
		"/api/v1/orders",
		"/api/v1/products",
		"/api/v1/comments",
		"/api/v1/cart",
	}

	b.ResetTimer()
	start := time.Now()

	var wg sync.WaitGroup
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			ep := endpoints[workerID%len(endpoints)]
			rule := fmt.Sprintf("Rule-%d", workerID%4)
			for i := 0; i < reqsPerWorker; i++ {
				blocked := (i % 20) == 0
				throttled := (i % 50) == 0
				collector.RecordEvent(ep, "POST", rule, blocked, throttled)
			}
		}(w)
	}

	wg.Wait()
	duration := time.Since(start)
	throughput := float64(totalRequests) / duration.Seconds()
	b.Logf("--> Processed %d requests in %v (Throughput: %.2f reqs/sec)", totalRequests, duration, throughput)
}
