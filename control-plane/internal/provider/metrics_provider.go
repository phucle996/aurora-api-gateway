package provider

import (
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

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

// MetricsProvider là interface trừu tượng định nghĩa hợp đồng chung cho các nguồn thu thập và trích xuất Metrics.
type MetricsProvider interface {
	GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error)
	PushMetricPoint(nodeID string, pt entity.NodeMetricPoint)
	GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint
	Start(ctx context.Context) error
	Stop() error
}

// NewMetricsProvider khởi tạo provider thích ứng dựa trên cấu hình mode ("standalone", "prometheus", "disabled").
func NewMetricsProvider(cfg entity.MetricsIntegrationConfig, nodeRepo repo.NodeRepository, client *http.Client) MetricsProvider {
	switch cfg.Mode {
	case "standalone":
		return NewStandaloneMetricsProvider(nodeRepo)
	case "prometheus":
		return NewPrometheusMetricsProvider(cfg.PrometheusURL, cfg.PrometheusJob, client)
	case "disabled":
		return NewDisabledMetricsProvider()
	default:
		return NewDisabledMetricsProvider()
	}
}

// ─── 1. Standalone Provider (In-Memory Ring Buffer & SQLite History) ─────────

type StandaloneMetricsProvider struct {
	nodeRepo      repo.NodeRepository
	mu            sync.RWMutex
	buffers       map[string][]entity.NodeMetricPoint
	rollupBuckets map[string]standaloneRollup

	cancelFunc context.CancelFunc
	wg         sync.WaitGroup
}

// Fixed-size accumulator per node; never retain every heartbeat until disk flush.
type standaloneRollup struct {
	scope         string
	count         uint64
	cpu, mem, rps float64
	connections   int
	timestamp     int64
}

// NewStandaloneMetricsProvider khởi tạo Standalone Metrics Provider lưu trữ in-memory và ghi batch SQLite.
func NewStandaloneMetricsProvider(nodeRepo repo.NodeRepository) *StandaloneMetricsProvider {
	return &StandaloneMetricsProvider{
		nodeRepo:      nodeRepo,
		buffers:       make(map[string][]entity.NodeMetricPoint),
		rollupBuckets: make(map[string]standaloneRollup),
	}
}

func (p *StandaloneMetricsProvider) Start(parentCtx context.Context) error {
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
				if err := p.FlushRollupBatch(); err != nil {
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

func (p *StandaloneMetricsProvider) Stop() error {
	p.mu.Lock()
	cancel := p.cancelFunc
	p.cancelFunc = nil
	p.mu.Unlock()

	if cancel != nil {
		cancel()
		p.wg.Wait()
		// Flush nốt phần còn lại trước khi dừng hẳn
		return p.FlushRollupBatch()
	}
	return nil
}

func (p *StandaloneMetricsProvider) PushMetricPoint(nodeID string, pt entity.NodeMetricPoint) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// 1. Cập nhật Ring Buffer trong RAM (tối đa 60 điểm cho UI thời gian thực)
	buf := p.buffers[nodeID]
	if len(buf) > 0 && pt.Timestamp <= buf[len(buf)-1].Timestamp {
		return
	}
	buf = append(buf, pt)
	for len(buf) > 0 && buf[0].Timestamp < pt.Timestamp-3600 {
		buf = buf[1:]
	}
	if len(buf) > 3601 {
		buf = buf[len(buf)-3601:]
	}
	p.buffers[nodeID] = buf

	// 2. Tích lũy vào bucket để Rollup Worker gom ghi SQLite
	a := p.rollupBuckets[nodeID]
	if a.scope != pt.MetricsScope {
		a = standaloneRollup{scope: pt.MetricsScope}
	}
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

func (p *StandaloneMetricsProvider) GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint {
	p.mu.RLock()
	defer p.mu.RUnlock()

	buf, exists := p.buffers[nodeID]
	if !exists || len(buf) == 0 {
		return nil
	}
	latest := buf[len(buf)-1]
	if time.Now().Unix()-latest.Timestamp > 45 {
		return nil
	}
	return &latest
}

func (p *StandaloneMetricsProvider) GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	now := time.Now().Unix()
	byTime := map[int64]entity.NodeMetricPoint{}
	if p.nodeRepo != nil {
		history, err := p.nodeRepo.GetRecentMetricsHistory(ctx, nodeID, 3601)
		if err != nil {
			return nil, err
		}
		for _, pt := range history {
			if pt.Timestamp >= now-3600 && pt.Timestamp <= now {
				byTime[pt.Timestamp] = pt
			}
		}
	}
	p.mu.RLock()
	for _, pt := range p.buffers[nodeID] {
		if pt.Timestamp >= now-3600 && pt.Timestamp <= now {
			byTime[pt.Timestamp] = pt
		}
	}
	p.mu.RUnlock()
	out := make([]entity.NodeMetricPoint, 0, len(byTime))
	for _, pt := range byTime {
		out = append(out, pt)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp < out[j].Timestamp })
	return out, nil
}

// FlushRollupBatch gom xả các mẫu tích lũy xuống SQLite repository.
func (p *StandaloneMetricsProvider) FlushRollupBatch() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.rollupBuckets) == 0 || p.nodeRepo == nil {
		return nil
	}

	var batch []entity.NodeMetricHistoryRecord
	for nodeID, a := range p.rollupBuckets {
		batch = append(batch, entity.NodeMetricHistoryRecord{
			NodeID:            nodeID,
			MetricsScope:      a.scope,
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

// IsRunning kiểm tra xem background workers của StandaloneMetricsProvider có đang chạy hay không.
func (p *StandaloneMetricsProvider) IsRunning() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cancelFunc != nil
}

// RollupCount trả về số lượng mẫu đo tích lũy hiện tại trong bucket của nodeID.
func (p *StandaloneMetricsProvider) RollupCount(nodeID string) uint64 {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.rollupBuckets[nodeID].count
}

// BufferLen trả về số lượng mẫu đo hiện có trong buffer RAM của nodeID.
func (p *StandaloneMetricsProvider) BufferLen(nodeID string) int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.buffers[nodeID])
}

// RollupBucketsLen trả về số lượng bucket rollup đang lưu trữ.
func (p *StandaloneMetricsProvider) RollupBucketsLen() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.rollupBuckets)
}

// ─── 2. Prometheus Provider (External Prometheus / VictoriaMetrics PromQL) ────

type PrometheusMetricsProvider struct {
	promURL    string
	jobName    string
	httpClient *http.Client
}

// NewPrometheusMetricsProvider khởi tạo provider truy vấn Prometheus qua HTTP PromQL.
func NewPrometheusMetricsProvider(promURL, jobName string, client *http.Client) *PrometheusMetricsProvider {
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	return &PrometheusMetricsProvider{
		promURL:    promURL,
		jobName:    jobName,
		httpClient: client,
	}
}

func (p *PrometheusMetricsProvider) Start(context.Context) error { return nil }
func (p *PrometheusMetricsProvider) Stop() error                 { return nil }
func (p *PrometheusMetricsProvider) PushMetricPoint(string, entity.NodeMetricPoint) {
	// No-op: ở chế độ Prometheus, việc lưu trữ metrics do Prometheus Server đảm nhiệm qua /metrics endpoint
}
func (p *PrometheusMetricsProvider) GetLatestMetricPoint(string) *entity.NodeMetricPoint {
	return nil
}

func (p *PrometheusMetricsProvider) GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	now := time.Now().Unix()
	start := now - 3600 // 1 giờ gần nhất
	step := 15          // 15 giây để biểu đồ chi tiết và phản hồi ngay các mẫu đo mới

	query := fmt.Sprintf(`{__name__=~"system_cpu_utilization_ratio|system_memory_utilization_ratio|http_connections_active|http_requests_per_second|aurora_node_cpu_percent|aurora_node_memory_percent|aurora_node_active_connections|aurora_node_requests_per_second",node_id=%s,job=%s}`, strconv.Quote(nodeID), strconv.Quote(p.jobName))
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
	scope := ""
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
		seriesScope := series.Metric["metrics_scope"]
		if len(seen) > 1 && scope != seriesScope {
			return nil, taxonomy.ErrMetricsUnavailable
		}
		scope = seriesScope
		var mask uint8
		isRatio := false
		switch name {
		case "system_cpu_utilization_ratio":
			mask = 1
			isRatio = true
		case "aurora_node_cpu_percent":
			mask = 1
		case "system_memory_utilization_ratio":
			mask = 2
			isRatio = true
		case "aurora_node_memory_percent":
			mask = 2
		case "http_connections_active", "aurora_node_active_connections":
			mask = 4
		case "http_requests_per_second", "aurora_node_requests_per_second":
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
			if isRatio && val <= 1.0 {
				val = val * 100.0
			}
			sec := int64(ts)
			pt := byTime[sec]
			pt.Timestamp = sec
			pt.MetricsScope = scope
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

type DisabledMetricsProvider struct{}

// NewDisabledMetricsProvider khởi tạo provider vô hiệu hóa tính năng metrics.
func NewDisabledMetricsProvider() *DisabledMetricsProvider {
	return &DisabledMetricsProvider{}
}

func (p *DisabledMetricsProvider) Start(context.Context) error                         { return nil }
func (p *DisabledMetricsProvider) Stop() error                                         { return nil }
func (p *DisabledMetricsProvider) PushMetricPoint(string, entity.NodeMetricPoint)      {}
func (p *DisabledMetricsProvider) GetLatestMetricPoint(string) *entity.NodeMetricPoint { return nil }
func (p *DisabledMetricsProvider) GetNodeTimeline(context.Context, string) ([]entity.NodeMetricPoint, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
