package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
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
	rollupBuckets map[string][]entity.NodeMetricPoint

	cancelFunc context.CancelFunc
	wg         sync.WaitGroup
}

func newStandaloneProvider(nodeRepo repo.NodeRepository) *standaloneMetricsProvider {
	return &standaloneMetricsProvider{
		nodeRepo:      nodeRepo,
		buffers:       make(map[string][]entity.NodeMetricPoint),
		rollupBuckets: make(map[string][]entity.NodeMetricPoint),
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
				p.flushRollupBatch()
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
					_ = p.nodeRepo.CleanupExpiredMetricsHistory(context.Background(), 7)
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
		p.flushRollupBatch()
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
	p.rollupBuckets[nodeID] = append(p.rollupBuckets[nodeID], pt)
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
		if err == nil && len(history) > 0 {
			return history, nil
		}
	}

	return []entity.NodeMetricPoint{}, nil
}

func (p *standaloneMetricsProvider) flushRollupBatch() {
	p.mu.Lock()
	if len(p.rollupBuckets) == 0 || p.nodeRepo == nil {
		p.mu.Unlock()
		return
	}

	var batch []entity.NodeMetricHistoryRecord
	for nodeID, pts := range p.rollupBuckets {
		if len(pts) == 0 {
			continue
		}
		var totalCPU, totalMem, totalRPS float64
		var maxConns int
		for _, pt := range pts {
			totalCPU += pt.CPUUsage
			totalMem += pt.MemoryUsage
			totalRPS += pt.RPS
			if pt.ActiveConnections > maxConns {
				maxConns = pt.ActiveConnections
			}
		}
		count := float64(len(pts))
		batch = append(batch, entity.NodeMetricHistoryRecord{
			NodeID:            nodeID,
			Timestamp:         pts[len(pts)-1].Timestamp,
			CPUUsage:          totalCPU / count,
			MemoryUsage:       totalMem / count,
			ActiveConnections: maxConns,
			RequestsPerSecond: totalRPS / count,
		})
		delete(p.rollupBuckets, nodeID)
	}
	p.mu.Unlock()

	if len(batch) > 0 {
		_ = p.nodeRepo.BatchInsertMetricsHistory(context.Background(), batch)
	}
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
	step := 60          // 60 giây

	query := fmt.Sprintf(`aurora_node_cpu_percent{node_id="%s"}`, nodeID)
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

	if err := json.NewDecoder(resp.Body).Decode(&promResp); err != nil || promResp.Status != "success" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	var points []entity.NodeMetricPoint
	if len(promResp.Data.Result) > 0 {
		for _, v := range promResp.Data.Result[0].Values {
			if len(v) >= 2 {
				tsFloat, ok1 := v[0].(float64)
				valStr, ok2 := v[1].(string)
				if ok1 && ok2 {
					cpuVal, _ := strconv.ParseFloat(valStr, 64)
					points = append(points, entity.NodeMetricPoint{
						Timestamp: int64(tsFloat),
						CPUUsage:  cpuVal,
					})
				}
			}
		}
	}

	return points, nil
}

// ─── 3. Disabled Provider (Không thu thập, không tiêu tốn tài nguyên) ─────────

type disabledMetricsProvider struct{}

func newDisabledProvider() *disabledMetricsProvider {
	return &disabledMetricsProvider{}
}

func (p *disabledMetricsProvider) Start(context.Context) error                          { return nil }
func (p *disabledMetricsProvider) Stop() error                                          { return nil }
func (p *disabledMetricsProvider) PushMetricPoint(string, entity.NodeMetricPoint)       {}
func (p *disabledMetricsProvider) GetLatestMetricPoint(string) *entity.NodeMetricPoint { return nil }
func (p *disabledMetricsProvider) GetNodeTimeline(context.Context, string) ([]entity.NodeMetricPoint, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
