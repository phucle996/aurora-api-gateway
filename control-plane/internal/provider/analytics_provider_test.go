package provider_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/provider/catalog"
)

func TestCatalogPromQLCompilation(t *testing.T) {
	queryItem := entity.AnalyticsQueryItem{
		ID:          "A",
		MetricKey:   "traffic.requests_rate",
		Aggregation: "sum",
		Filters: map[string]string{
			"node_id": "node-sg-01",
			"status":  "200",
		},
		GroupBy: []string{"node_id", "status"},
	}

	promQL, err := catalog.BuildPromQL(queryItem, "1m")
	if err != nil {
		t.Fatalf("BuildPromQL thất bại: %v", err)
	}

	if !strings.Contains(promQL, "sum by (node_id,status)") {
		t.Errorf("PromQL thiếu group_by chính xác: %s", promQL)
	}
	if !strings.Contains(promQL, `node_id="node-sg-01"`) || !strings.Contains(promQL, `status="200"`) {
		t.Errorf("PromQL thiếu bộ lọc filters: %s", promQL)
	}
}

func TestCatalogExtensionFilter(t *testing.T) {
	activeExts := map[string]bool{
		"waf_engine": false,
		"rate_limit": true,
	}

	cats := catalog.FilterCategoriesByActiveExtensions(activeExts)
	for _, c := range cats {
		if c.ID == "waf" {
			t.Errorf("danh mục WAF không nên xuất hiện khi waf_engine tắt")
		}
	}

	foundRateLimit := false
	for _, c := range cats {
		if c.ID == "rate_limit" {
			foundRateLimit = true
		}
	}
	if !foundRateLimit {
		t.Errorf("danh mục rate_limit phải xuất hiện khi extension bật")
	}
}

func TestPrometheusProviderQueryRangeAndInstant(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "query_range") {
			resp := map[string]any{
				"status": "success",
				"data": map[string]any{
					"resultType": "matrix",
					"result": []any{
						map[string]any{
							"metric": map[string]string{"node_id": "test-node", "status": "200"},
							"values": []any{
								[]any{float64(time.Now().Unix() - 15), "10.5"},
								[]any{float64(time.Now().Unix()), "12.0"},
							},
						},
					},
				},
			}
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		if strings.Contains(r.URL.Path, "query") {
			resp := map[string]any{
				"status": "success",
				"data": map[string]any{
					"resultType": "vector",
					"result": []any{
						map[string]any{
							"metric": map[string]string{"node_id": "test-node"},
							"value":  []any{float64(time.Now().Unix()), "1"},
						},
					},
				},
			}
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
	}))
	defer mockServer.Close()

	prov := provider.NewPrometheusMetricsProvider(mockServer.URL, "aurora-waf", mockServer.Client())

	// Test connection
	connRes, err := prov.TestConnection(context.Background())
	if err != nil || !connRes.Success {
		t.Fatalf("TestConnection thất bại: %+v, err: %v", connRes, err)
	}

	// Test QueryRange
	matrix, err := prov.QueryRange(context.Background(), "up", time.Now().Unix()-60, time.Now().Unix(), 15)
	if err != nil {
		t.Fatalf("QueryRange lỗi: %v", err)
	}
	if len(matrix.Data.Result) != 1 {
		t.Fatalf("kỳ vọng 1 series, nhận được: %d", len(matrix.Data.Result))
	}

	// Test QueryInstant
	vector, err := prov.QueryInstant(context.Background(), "up")
	if err != nil {
		t.Fatalf("QueryInstant lỗi: %v", err)
	}
	if len(vector.Data.Result) != 1 {
		t.Fatalf("kỳ vọng 1 kết quả vector, nhận: %d", len(vector.Data.Result))
	}
}

// Protocol-boundary tests deliberately supply incomplete/ambiguous Prometheus
// responses. Integration pressure tests use a real Prometheus process instead.
func TestPrometheusTimelineRejectsIncompleteOrAmbiguousSeries(t *testing.T) {
	for _, kind := range []string{"complete", "empty", "missing", "duplicate", "wrong-job", "wrong-node", "mixed-instance", "nan", "malformed", "too-large"} {
		t.Run(kind, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.URL.Query().Get("query"), `node_id="node\"test"`) || !strings.Contains(r.URL.Query().Get("query"), `job="real-job"`) {
					t.Error("label selector not quoted/isolated")
				}
				if kind == "too-large" {
					_, _ = w.Write([]byte(strings.Repeat(" ", 2*1024*1024+1)))
					return
				}
				if kind == "malformed" {
					_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[{}]}}`))
					return
				}
				now := time.Now().Unix() - 1
				series := []any{}
				for i, name := range []string{"aurora_node_cpu_percent", "aurora_node_memory_percent", "aurora_node_active_connections", "aurora_node_requests_per_second"} {
					if kind == "missing" && i == 3 {
						continue
					}
					labels := map[string]string{"__name__": name, "node_id": "node\"test", "job": "real-job", "instance": "one"}
					if kind == "wrong-job" {
						labels["job"] = "other"
					}
					if kind == "wrong-node" {
						labels["node_id"] = "other"
					}
					if kind == "mixed-instance" && i == 1 {
						labels["instance"] = "two"
					}
					values := []any{[]any{now, "10"}}
					if kind == "nan" && i == 0 {
						values = []any{[]any{now, "NaN"}}
					}
					series = append(series, map[string]any{"metric": labels, "values": values})
					if kind == "duplicate" && i == 0 {
						series = append(series, map[string]any{"metric": labels, "values": values})
					}
				}
				if kind == "empty" {
					series = nil
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": "success",
					"data":   map[string]any{"resultType": "matrix", "result": series},
				})
			}))
			defer upstream.Close()

			p := provider.NewPrometheusMetricsProvider(upstream.URL, "real-job", upstream.Client())
			points, err := p.GetNodeTimeline(context.Background(), `node"test`)
			if kind == "complete" {
				if err != nil || len(points) != 1 {
					t.Fatalf("expected 1 complete point, got %v (%d points)", err, len(points))
				}
				return
			}
			if err == nil {
				t.Fatalf("expected failure for %s, got points: %+v", kind, points)
			}
		})
	}
}
