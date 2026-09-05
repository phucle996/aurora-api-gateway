package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MetricsProvider là interface trừu tượng định nghĩa hợp đồng chung cho các nguồn thu thập và trích xuất Metrics.
type MetricsProvider interface {
	GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error)
	PushMetricPoint(nodeID string, pt entity.NodeMetricPoint)
	GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint
	Start(ctx context.Context) error
	Stop() error
}

// ─── 1. Standalone Provider (In-Memory Ring Buffer & SQLite History) ─────────

type standaloneMetricsProvider struct {
	nodeRepo      repo.NodeRepository
	mu            sync.RWMutex
	buffers       map[string][]entity.NodeMetricPoint
	rollupBuckets map[string]standaloneRollup

	cancelFunc context.CancelFunc
	wg         sync.WaitGroup
}

// Fixed-size accumulator per node; never retain every heartbeat until disk flush.
type standaloneRollup struct {
	count         uint64
	cpu, mem, rps float64
	connections   int
	timestamp     int64
}

func newStandaloneProvider(nodeRepo repo.NodeRepository) *standaloneMetricsProvider {
	return &standaloneMetricsProvider{
		nodeRepo:      nodeRepo,
		buffers:       make(map[string][]entity.NodeMetricPoint),
		rollupBuckets: make(map[string]standaloneRollup),
	}
}

func (p *standaloneMetricsProvider) Start(parentCtx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.cancelFunc != nil {
		return nil // Đã chạy rồi
	}

	ctx, cancel := context.WithCancel(parentCtx)
	p.cancelFunc = cancel

	// Khởi chạy Rollup Worker (mỗi 1 phút gom batch vào SQLite)
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := p.flushRollupBatch(); err != nil {
					slog.Error("metrics rollup failed; accumulated samples retained", "error", err)
				}
			}
		}
	}()

	// Khởi chạy Cleaner dọn dẹp metrics cũ (mỗi ~1 giờ kèm jitter ±5m)
	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		for {
			jitterSec := rand.Intn(600) - 300
			nextCleanup := time.Duration(3600+jitterSec) * time.Second
			if nextCleanup < 30*time.Minute {
				nextCleanup = 30 * time.Minute
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(nextCleanup):
				if p.nodeRepo != nil {
					cleanupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
					_ = p.nodeRepo.CleanupExpiredMetricsHistory(cleanupCtx, 7)
					cancel()
				}
			}
		}
	}()

	return nil
}

func (p *standaloneMetricsProvider) Stop() error {
	p.mu.Lock()
	cancel := p.cancelFunc
	p.cancelFunc = nil
	p.mu.Unlock()

	if cancel != nil {
		cancel()
		p.wg.Wait()
		// Flush nốt phần còn lại trước khi dừng hẳn
		return p.flushRollupBatch()
	}
	return nil
}

func (p *standaloneMetricsProvider) PushMetricPoint(nodeID string, pt entity.NodeMetricPoint) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// 1. Cập nhật Ring Buffer trong RAM (tối đa 60 điểm cho UI thời gian thực)
	buf := p.buffers[nodeID]
	buf = append(buf, pt)
	if len(buf) > 60 {
		buf = buf[len(buf)-60:]
	}
	p.buffers[nodeID] = buf

	// 2. Tích lũy vào bucket để Rollup Worker gom ghi SQLite
	a := p.rollupBuckets[nodeID]
	a.count++
	// Online means keep sums bounded even if storage stays unavailable.
	a.cpu += (pt.CPUUsage - a.cpu) / float64(a.count)
	a.mem += (pt.MemoryUsage - a.mem) / float64(a.count)
	a.rps += (pt.RPS - a.rps) / float64(a.count)
	if pt.ActiveConnections > a.connections {
		a.connections = pt.ActiveConnections
	}
	if pt.Timestamp > a.timestamp {
		a.timestamp = pt.Timestamp
	}
	p.rollupBuckets[nodeID] = a
}

func (p *standaloneMetricsProvider) GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint {
	p.mu.RLock()
	defer p.mu.RUnlock()

	buf, exists := p.buffers[nodeID]
	if !exists || len(buf) == 0 {
		return nil
	}
	latest := buf[len(buf)-1]
	return &latest
}

func (p *standaloneMetricsProvider) GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	p.mu.RLock()
	points, exists := p.buffers[nodeID]
	if exists && len(points) > 0 {
		out := make([]entity.NodeMetricPoint, len(points))
		copy(out, points)
		p.mu.RUnlock()
		return out, nil
	}
	p.mu.RUnlock()

	// Nếu RAM chưa có (vừa restart), hydrate từ SQLite
	if p.nodeRepo != nil {
		history, err := p.nodeRepo.GetRecentMetricsHistory(ctx, nodeID, 60)
		if err != nil {
			return nil, err
		}
		if len(history) > 0 {
			return history, nil
		}
	}

	return []entity.NodeMetricPoint{}, nil
}

func (p *standaloneMetricsProvider) flushRollupBatch() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.rollupBuckets) == 0 || p.nodeRepo == nil {
		return nil
	}

	var batch []entity.NodeMetricHistoryRecord
	for nodeID, a := range p.rollupBuckets {
		batch = append(batch, entity.NodeMetricHistoryRecord{
			NodeID:            nodeID,
			Timestamp:         a.timestamp,
			CPUUsage:          a.cpu,
			MemoryUsage:       a.mem,
			ActiveConnections: a.connections,
			RequestsPerSecond: a.rps,
		})
	}

	if len(batch) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := p.nodeRepo.BatchInsertMetricsHistory(ctx, batch); err != nil {
			return err
		}
		clear(p.rollupBuckets)
	}
	return nil
}

// ─── 2. Prometheus Provider (External Prometheus / VictoriaMetrics PromQL) ────

type prometheusMetricsProvider struct {
	promURL    string
	jobName    string
	httpClient *http.Client
}

func newPrometheusProvider(promURL, jobName string, client *http.Client) *prometheusMetricsProvider {
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	return &prometheusMetricsProvider{
		promURL:    promURL,
		jobName:    jobName,
		httpClient: client,
	}
}

func (p *prometheusMetricsProvider) Start(context.Context) error { return nil }
func (p *prometheusMetricsProvider) Stop() error                 { return nil }
func (p *prometheusMetricsProvider) PushMetricPoint(string, entity.NodeMetricPoint) {
	// No-op: ở chế độ Prometheus, việc lưu trữ metrics do Prometheus Server đảm nhiệm qua /metrics endpoint
}
func (p *prometheusMetricsProvider) GetLatestMetricPoint(string) *entity.NodeMetricPoint {
	return nil
}

func (p *prometheusMetricsProvider) GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	now := time.Now().Unix()
	start := now - 3600 // 1 giờ gần nhất
	step := 15          // 15 giây để biểu đồ chi tiết và phản hồi ngay các mẫu đo mới

	query := fmt.Sprintf(`{__name__=~"aurora_node_cpu_percent|aurora_node_memory_percent|aurora_node_active_connections|aurora_node_requests_per_second",node_id=%s,job=%s}`, strconv.Quote(nodeID), strconv.Quote(p.jobName))
	u := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		strings.TrimRight(p.promURL, "/"),
		url.QueryEscape(query),
		start, now, step)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, taxonomy.ErrMetricsUnavailable
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	var promResp struct {
		Status string `json:"status"`
		Data   struct {
			ResultType string `json:"resultType"`
			Result     []struct {
				Metric map[string]string `json:"metric"`
				Values [][]any           `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		return nil, taxonomy.ErrMetricsUnavailable
	}
	if err := json.Unmarshal(data, &promResp); err != nil || promResp.Status != "success" || promResp.Data.ResultType != "matrix" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	points := []entity.NodeMetricPoint{}
	byTime := map[int64]entity.NodeMetricPoint{}
	fields := map[int64]uint8{}
	seen := map[string]bool{}
	instance := ""
	for _, series := range promResp.Data.Result {
		name := series.Metric["__name__"]
		if series.Metric["node_id"] != nodeID || series.Metric["job"] != p.jobName || seen[name] {
			return nil, taxonomy.ErrMetricsUnavailable
		}
		if len(seen) > 0 && instance != series.Metric["instance"] {
			return nil, taxonomy.ErrMetricsUnavailable
		}
		seen[name] = true
		instance = series.Metric["instance"]
		var mask uint8
		switch name {
		case "aurora_node_cpu_percent":
			mask = 1
		case "aurora_node_memory_percent":
			mask = 2
		case "aurora_node_active_connections":
			mask = 4
		case "aurora_node_requests_per_second":
			mask = 8
		default:
			return nil, taxonomy.ErrMetricsUnavailable
		}
		for _, v := range series.Values {
			if len(v) != 2 {
				return nil, taxonomy.ErrMetricsUnavailable
			}
			ts, ok := v[0].(float64)
			raw, ok2 := v[1].(string)
			val, parseErr := strconv.ParseFloat(raw, 64)
			if !ok || !ok2 || parseErr != nil || math.IsNaN(val) || math.IsInf(val, 0) || val < 0 || math.IsNaN(ts) || math.IsInf(ts, 0) || ts < float64(start) || ts > float64(now) || ts != math.Trunc(ts) {
				return nil, taxonomy.ErrMetricsUnavailable
			}
			if (mask == 1 || mask == 2) && val > 100 || mask == 4 && (val > 1e9 || val != math.Trunc(val)) {
				return nil, taxonomy.ErrMetricsUnavailable
			}
			sec := int64(ts)
			pt := byTime[sec]
			pt.Timestamp = sec
			pt.TimeLabel = time.Unix(sec, 0).UTC().Format("15:04:05")
			if fields[sec]&mask != 0 {
				return nil, taxonomy.ErrMetricsUnavailable
			}
			switch mask {
			case 1:
				pt.CPUUsage = val
			case 2:
				pt.MemoryUsage = val
			case 4:
				pt.ActiveConnections = int(val)
			case 8:
				pt.RPS = val
			}
			byTime[sec] = pt
			fields[sec] |= mask
		}
	}
	for ts, pt := range byTime {
		if fields[ts] != 15 {
			return nil, taxonomy.ErrMetricsUnavailable
		}
		points = append(points, pt)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].Timestamp < points[j].Timestamp })
	return points, nil
}

// ─── 3. Disabled Provider (Không thu thập, không tiêu tốn tài nguyên) ─────────

type disabledMetricsProvider struct{}

func newDisabledProvider() *disabledMetricsProvider {
	return &disabledMetricsProvider{}
}

func (p *disabledMetricsProvider) Start(context.Context) error                         { return nil }
func (p *disabledMetricsProvider) Stop() error                                         { return nil }
func (p *disabledMetricsProvider) PushMetricPoint(string, entity.NodeMetricPoint)      {}
func (p *disabledMetricsProvider) GetLatestMetricPoint(string) *entity.NodeMetricPoint { return nil }
func (p *disabledMetricsProvider) GetNodeTimeline(context.Context, string) ([]entity.NodeMetricPoint, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
