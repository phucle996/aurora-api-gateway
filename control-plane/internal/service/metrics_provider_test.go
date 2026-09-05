package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Fault injection belongs only to the rollup persistence boundary.
type failingRollupRepository struct {
	repo.NodeRepository
	fail    bool
	written []entity.NodeMetricHistoryRecord
}

type rejectedMetricsConfigRepository struct{ repo.SettingsRepository }

func (r *rejectedMetricsConfigRepository) SaveMetricsConfig(context.Context, entity.MetricsIntegrationConfig) error {
	return errors.New("configuration commit rejected")
}

func TestMetricsFailedTransitionRestartsOldProvider(t *testing.T) {
	for _, failFlush := range []bool{false, true} {
		t.Run(strconv.FormatBool(failFlush), func(t *testing.T) {
			r := &failingRollupRepository{fail: failFlush}
			p := newStandaloneProvider(r)
			if err := p.Start(context.Background()); err != nil {
				t.Fatal(err)
			}
			defer func() { r.fail = false; _ = p.Stop() }()
			p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: 1, CPUUsage: 20})
			s := &metricsService{repo: &rejectedMetricsConfigRepository{}, activeProvider: p, currentConfig: entity.MetricsIntegrationConfig{Mode: "standalone"}}
			if s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"}) == nil {
				t.Fatal("failed transition accepted")
			}
			if s.currentConfig.Mode != "standalone" || s.activeProvider != p {
				t.Fatal("uncommitted mode installed")
			}
			p.mu.RLock()
			running := p.cancelFunc != nil
			retained := p.rollupBuckets["node"].count
			p.mu.RUnlock()
			if !running || (failFlush && retained != 1) {
				t.Fatal("old provider did not recover", running, retained)
			}
		})
	}
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

func TestStandaloneRollupRetainsFailedBatchAndBoundsMemory(t *testing.T) {
	r := &failingRollupRepository{fail: true}
	p := newStandaloneProvider(r)
	for i := 1; i <= 100000; i++ {
		p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: int64(i), CPUUsage: 20, MemoryUsage: 30, RPS: 50000, ActiveConnections: 8})
	}
	if len(p.buffers["node"]) != 60 || len(p.rollupBuckets) != 1 || p.rollupBuckets["node"].count != 100000 {
		t.Fatal("unbounded or lost samples")
	}
	if p.flushRollupBatch() == nil || p.rollupBuckets["node"].count != 100000 {
		t.Fatal("failed write lost rollup")
	}
	r.fail = false
	if err := p.flushRollupBatch(); err != nil {
		t.Fatal(err)
	}
	if len(p.rollupBuckets) != 0 || len(r.written) != 1 {
		t.Fatal("retry did not settle exactly once")
	}
	row := r.written[0]
	if row.Timestamp != 100000 || row.CPUUsage != 20 || row.MemoryUsage != 30 || row.RequestsPerSecond != 50000 || row.ActiveConnections != 8 {
		t.Fatal(row)
	}
	if err := p.flushRollupBatch(); err != nil || len(r.written) != 1 {
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
			p := newPrometheusProvider(upstream.URL, "real-job", nil)
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
