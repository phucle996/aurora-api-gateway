package provider_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/provider"
)

// Fault injection repository for rollup boundary tests.
type failingRollupRepository struct {
	repo.NodeRepository
	fail    bool
	written []entity.NodeMetricHistoryRecord
}

func (r *failingRollupRepository) BatchInsertMetricsHistory(ctx context.Context, rows []entity.NodeMetricHistoryRecord) error {
	if _, ok := ctx.Deadline(); !ok {
		return errors.New("missing write deadline")
	}
	if r.fail {
		return errors.New("storage unavailable")
	}
	r.written = append(r.written, rows...)
	return nil
}

func (r *failingRollupRepository) GetRecentMetricsHistory(context.Context, string, int) ([]entity.NodeMetricPoint, error) {
	return []entity.NodeMetricPoint{
		{Timestamp: time.Now().Unix() - 3500, CPUUsage: 10, MetricsScope: "container"},
		{Timestamp: time.Now().Unix() - 4000, CPUUsage: 99, MetricsScope: "container"},
	}, nil
}

func TestStandaloneRollupRetainsFailedBatchAndBoundsMemory(t *testing.T) {
	r := &failingRollupRepository{fail: true}
	p := provider.NewStandaloneMetricsProvider(r)
	for i := 1; i <= 100000; i++ {
		p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: int64(i), CPUUsage: 20, MemoryUsage: 30, RPS: 50000, ActiveConnections: 8})
	}
	if p.BufferLen("node") != 3601 || p.RollupBucketsLen() != 1 || p.RollupCount("node") != 100000 {
		t.Fatal("unbounded or lost samples")
	}
	if p.FlushRollupBatch() == nil || p.RollupCount("node") != 100000 {
		t.Fatal("failed write lost rollup")
	}
	r.fail = false
	if err := p.FlushRollupBatch(); err != nil {
		t.Fatal(err)
	}
	if p.RollupBucketsLen() != 0 || len(r.written) != 1 {
		t.Fatal("retry did not settle exactly once")
	}
	row := r.written[0]
	if row.Timestamp != 100000 || row.CPUUsage != 20 || row.MemoryUsage != 30 || row.RequestsPerSecond != 50000 || row.ActiveConnections != 8 {
		t.Fatal(row)
	}
	if err := p.FlushRollupBatch(); err != nil || len(r.written) != 1 {
		t.Fatal("settled batch replayed", err)
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
					if kind == "mixed-instance" && i == 3 {
						labels["instance"] = "two"
					}
					value := strconv.Itoa(i + 1)
					if kind == "nan" {
						value = "NaN"
					}
					record := map[string]any{"metric": labels, "values": []any{[]any{now, value}}}
					series = append(series, record)
					if kind == "duplicate" && i == 0 {
						series = append(series, record)
					}
				}
				if kind == "empty" {
					series = []any{}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "matrix", "result": series}})
			}))
			defer upstream.Close()
			p := provider.NewPrometheusMetricsProvider(upstream.URL, "real-job", nil)
			points, err := p.GetNodeTimeline(context.Background(), "node\"test")
			if kind == "complete" {
				if err != nil || len(points) != 1 || points[0].CPUUsage != 1 || points[0].MemoryUsage != 2 || points[0].ActiveConnections != 3 || points[0].RPS != 4 {
					t.Fatal(points, err)
				}
			} else if kind == "empty" {
				if err != nil || points == nil || len(points) != 0 {
					t.Fatal(points, err)
				}
			} else if err == nil {
				t.Fatal("invalid response accepted", points)
			}
		})
	}
}

func TestNodeTimelineMergesDurableHourWithLiveAndRejectsReplay(t *testing.T) {
	p := provider.NewStandaloneMetricsProvider(&failingRollupRepository{})
	now := time.Now().Unix()
	p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: now - 2, CPUUsage: 20, MetricsScope: "container"})
	p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: now - 3, CPUUsage: 99, MetricsScope: "container"})
	p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: now - 2, CPUUsage: 99, MetricsScope: "container"})
	points, err := p.GetNodeTimeline(context.Background(), "node")
	if err != nil || len(points) != 2 || points[0].CPUUsage != 10 || points[1].CPUUsage != 20 {
		t.Fatal(points, err)
	}
	restarted := provider.NewStandaloneMetricsProvider(&failingRollupRepository{})
	points, err = restarted.GetNodeTimeline(context.Background(), "node")
	if err != nil || len(points) != 1 || points[0].CPUUsage != 10 {
		t.Fatal(points, err)
	}
}
