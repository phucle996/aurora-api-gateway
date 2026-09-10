package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type mockAnalyticsRepo struct {
	repo.AnalyticsRepository
	cfg entity.MetricsIntegrationConfig
}

func (m *mockAnalyticsRepo) GetMetricsConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	return &m.cfg, nil
}

func (m *mockAnalyticsRepo) SaveMetricsConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	m.cfg = cfg
	return nil
}

func TestMetricsServiceAnalyticsQueryAndCatalog(t *testing.T) {
	mockProm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/query" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "success",
				"data": map[string]any{
					"resultType": "vector",
					"result": []any{
						map[string]any{"metric": map[string]string{}, "value": []any{float64(time.Now().Unix()), "1"}},
					},
				},
			})
			return
		}
		if r.URL.Path == "/api/v1/query_range" {
			now := time.Now().Unix()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "success",
				"data": map[string]any{
					"resultType": "matrix",
					"result": []any{
						map[string]any{
							"metric": map[string]string{"node_id": "sg-01", "status": "200"},
							"values": []any{
								[]any{float64(now - 15), "100.0"},
								[]any{float64(now), "120.0"},
							},
						},
					},
				},
			})
			return
		}
	}))
	defer mockProm.Close()

	analyticsRepo := &mockAnalyticsRepo{
		cfg: entity.MetricsIntegrationConfig{
			Mode:          "prometheus",
			PrometheusURL: mockProm.URL,
			PrometheusJob: "aurora-waf",
		},
	}

	svc := NewMetricsService(analyticsRepo, nil)

	// 1. GetCatalog
	catalogResp, err := svc.GetCatalog(context.Background())
	if err != nil {
		t.Fatalf("GetCatalog thất bại: %v", err)
	}
	if len(catalogResp.Sources) == 0 || catalogResp.Sources[0].Status != "connected" {
		t.Fatalf("kỳ vọng source connected: %+v", catalogResp.Sources)
	}
	if len(catalogResp.Categories) == 0 {
		t.Fatalf("kỳ vọng có categories trong catalog")
	}

	// 2. QueryAnalytics
	queryReq := entity.AnalyticsQueryRequest{
		SourceID: "prometheus",
		Queries: []entity.AnalyticsQueryItem{
			{
				ID:          "A",
				MetricKey:   "traffic.requests_rate",
				Aggregation: "sum",
				Filters: map[string]string{
					"node_id": "sg-01",
				},
				GroupBy: []string{"status"},
			},
		},
		Start: time.Now().Unix() - 300,
		End:   time.Now().Unix(),
		Step:  15,
	}

	res, err := svc.QueryAnalytics(context.Background(), queryReq)
	if err != nil {
		t.Fatalf("QueryAnalytics thất bại: %v", err)
	}
	if len(res.Series) != 1 {
		t.Fatalf("kỳ vọng 1 series, nhận: %d", len(res.Series))
	}
	if res.Series[0].QueryID != "A" || res.Series[0].Labels["status"] != "200" {
		t.Errorf("dữ liệu series không khớp: %+v", res.Series[0])
	}
	if len(res.Series[0].Values) != 2 || res.Series[0].Values[1] != 120.0 {
		t.Errorf("giá trị series không khớp: %+v", res.Series[0].Values)
	}

	// 3. QueryRaw
	rawRes, err := svc.QueryRaw(context.Background(), entity.AnalyticsRawQueryRequest{
		SourceID: "prometheus",
		Query:    "up",
		Start:    time.Now().Unix() - 60,
		End:      time.Now().Unix(),
		Step:     15,
	})
	if err != nil {
		t.Fatalf("QueryRaw thất bại: %v", err)
	}
	if len(rawRes.Series) != 1 {
		t.Fatalf("kỳ vọng 1 series từ QueryRaw")
	}
}
