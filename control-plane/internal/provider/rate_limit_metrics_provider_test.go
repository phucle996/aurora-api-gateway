package provider_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/provider"
)

type mockRateLimitRepo struct {
	statsCalled   bool
	metricsCalled bool
}

func (m *mockRateLimitRepo) Create(ctx context.Context, cmd entity.CreateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (m *mockRateLimitRepo) Update(ctx context.Context, cmd entity.UpdateRateLimitRuleCommand) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (m *mockRateLimitRepo) List(ctx context.Context, query entity.ListRateLimitRulesQuery) (*entity.ListRateLimitRulesResult, error) {
	return nil, nil
}
func (m *mockRateLimitRepo) GetByID(ctx context.Context, id int64) (*entity.RateLimitRuleItem, error) {
	return nil, nil
}
func (m *mockRateLimitRepo) Delete(ctx context.Context, id int64) error {
	return nil
}
func (m *mockRateLimitRepo) GetStats(ctx context.Context) (*entity.RateLimitStatsSummary, error) {
	m.statsCalled = true
	return &entity.RateLimitStatsSummary{
		TotalHits:    100,
		TotalBlocked: 20,
	}, nil
}
func (m *mockRateLimitRepo) GetMetrics(ctx context.Context, timeRange string, sortBy string) (*entity.RateLimitMetricsResult, error) {
	m.metricsCalled = true
	return &entity.RateLimitMetricsResult{
		VelocitySeries: []entity.RateLimitHourlyMetricItem{
			{Timestamp: "2026-09-07 07:00:00", TotalHits: 100, BlockedCount: 20},
		},
	}, nil
}
func (m *mockRateLimitRepo) BatchUpsertMetrics(ctx context.Context, hourly []entity.RateLimitHourlyMetricSample, endpoints []entity.RateLimitEndpointMetricSample) error {
	return nil
}

func TestStandaloneRateLimitMetricsProvider(t *testing.T) {
	repo := &mockRateLimitRepo{}
	p := provider.NewStandaloneRateLimitProvider(repo)

	stats, err := p.GetStats(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.TotalHits != 100 || !repo.statsCalled {
		t.Fatalf("expected 100 hits from mock repo")
	}

	metrics, err := p.GetMetrics(context.Background(), "24h", "blocked")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(metrics.VelocitySeries) != 1 || !repo.metricsCalled {
		t.Fatalf("expected 1 metric point from mock repo")
	}
}

func TestPrometheusRateLimitMetricsProvider_SuccessAndFallback(t *testing.T) {
	repo := &mockRateLimitRepo{}

	// Server mock Prometheus
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/query" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"data": {
					"resultType": "vector",
					"result": [
						{
							"metric": {"__name__": "aurora_rate_limit_hits_total"},
							"value": [1700000000, "500"]
						},
						{
							"metric": {"__name__": "aurora_rate_limit_blocked_total"},
							"value": [1700000000, "150"]
						}
					]
				}
			}`))
			return
		}
		if r.URL.Path == "/api/v1/query_range" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"data": {
					"resultType": "matrix",
					"result": [
						{
							"metric": {"__name__": "aurora_rate_limit_hits_total"},
							"values": [[1700000000, "200"], [1700003600, "300"]]
						},
						{
							"metric": {"__name__": "aurora_rate_limit_blocked_total"},
							"values": [[1700000000, "50"], [1700003600, "100"]]
						}
					]
				}
			}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	p := provider.NewPrometheusRateLimitProvider(server.URL, "aurora-waf", server.Client(), repo)

	stats, err := p.GetStats(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.TotalHits != 500 || stats.TotalBlocked != 150 {
		t.Fatalf("expected 500 hits and 150 blocked from Prometheus, got hits=%d, blocked=%d", stats.TotalHits, stats.TotalBlocked)
	}

	metrics, err := p.GetMetrics(context.Background(), "24h", "blocked")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(metrics.VelocitySeries) != 2 {
		t.Fatalf("expected 2 timeline items from Prometheus, got %d", len(metrics.VelocitySeries))
	}
}

func TestPrometheusRateLimitMetricsProvider_FallbackOnFailure(t *testing.T) {
	repo := &mockRateLimitRepo{}
	// Trỏ tới URL chết để kích hoạt fallback
	p := provider.NewPrometheusRateLimitProvider("http://127.0.0.1:19999", "aurora-waf", nil, repo)

	stats, err := p.GetStats(context.Background())
	if err != nil {
		t.Fatalf("expected fallback to succeed, got error: %v", err)
	}
	if stats.TotalHits != 100 || !repo.statsCalled {
		t.Fatalf("expected fallback to SQLite mock repo")
	}

	metrics, err := p.GetMetrics(context.Background(), "24h", "blocked")
	if err != nil {
		t.Fatalf("expected fallback to succeed, got error: %v", err)
	}
	if len(metrics.VelocitySeries) != 1 || !repo.metricsCalled {
		t.Fatalf("expected fallback to SQLite mock repo for metrics")
	}
}

func TestDisabledRateLimitMetricsProvider(t *testing.T) {
	p := provider.NewDisabledRateLimitProvider()
	if p.Mode() != "disabled" {
		t.Fatalf("expected mode disabled, got %s", p.Mode())
	}

	stats, err := p.GetStats(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.TotalHits != 0 || stats.TotalBlocked != 0 {
		t.Fatalf("expected 0 stats when disabled, got hits=%d", stats.TotalHits)
	}

	metrics, err := p.GetMetrics(context.Background(), "24h", "blocked")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(metrics.VelocitySeries) != 0 || len(metrics.TopEndpoints) != 0 {
		t.Fatalf("expected empty series and endpoints when disabled")
	}
}

