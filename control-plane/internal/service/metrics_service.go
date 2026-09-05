package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type metricsService struct {
	repo       repo.SettingsRepository
	nodeRepo   repo.NodeRepository
	httpClient *http.Client

	// In-Memory Ring Buffer cho biểu đồ thời gian thực (Live Real-time)
	// Lưu trữ tối đa 60 điểm dữ liệu (~10 phút) cho từng node trong RAM, phục vụ Web UI tức thì
	mu            sync.RWMutex
	buffers       map[string][]entity.NodeMetricPoint
	rollupBuckets map[string][]entity.NodeMetricPoint
}

// NewMetricsService khởi tạo service quản lý tích hợp Telemetry và Metrics.
func NewMetricsService(repo repo.SettingsRepository, nodeRepo repo.NodeRepository) domainService.MetricsService {
	s := &metricsService{
		repo:       repo,
		nodeRepo:   nodeRepo,
		httpClient: &http.Client{
			Timeout: 4 * time.Second,
		},
		buffers:       make(map[string][]entity.NodeMetricPoint),
		rollupBuckets: make(map[string][]entity.NodeMetricPoint),
	}
	s.startRollupWorker(context.Background())
	return s
}

// GetConfig lấy cấu hình tích hợp metrics hiện tại.
func (s *metricsService) GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	return s.repo.GetMetricsConfig(ctx)
}

// SaveConfig thẩm định và lưu cấu hình tích hợp metrics.
func (s *metricsService) SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	// Bước 1: Thẩm định chế độ hoạt động hợp lệ
	switch cfg.Mode {
	case "standalone", "prometheus", "disabled":
	default:
		return fmt.Errorf("chế độ metrics không hợp lệ: %s (chỉ chấp nhận 'standalone', 'prometheus', 'disabled')", cfg.Mode)
	}

	// Bước 2: Nếu là chế độ Prometheus, thẩm định định dạng URL
	if cfg.Mode == "prometheus" {
		cfg.PrometheusURL = strings.TrimSpace(cfg.PrometheusURL)
		u, err := url.ParseRequestURI(cfg.PrometheusURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("địa chỉ Prometheus URL không hợp lệ: phải bắt đầu bằng http:// hoặc https://")
		}
	}

	// Bước 3: Lưu cấu hình vào database
	return s.repo.SaveMetricsConfig(ctx, cfg)
}

// TestPrometheus kiểm tra khả năng kết nối tới Prometheus URL và đo độ trễ mạng.
func (s *metricsService) TestPrometheus(ctx context.Context, targetURL string) (*entity.TestConnectionResult, error) {
	targetURL = strings.TrimSpace(targetURL)
	u, err := url.ParseRequestURI(targetURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   "Địa chỉ URL không hợp lệ: phải bắt đầu bằng http:// hoặc https://",
			LatencyMs: 0,
		}, nil
	}

	// Gọi Prometheus API chuẩn để kiểm tra liveness: /api/v1/query?query=up
	probeURL := fmt.Sprintf("%s/api/v1/query?query=up", strings.TrimRight(targetURL, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   fmt.Sprintf("Khởi tạo HTTP request thất bại: %v", err),
			LatencyMs: 0,
		}, nil
	}

	start := time.Now()
	resp, err := s.httpClient.Do(req)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   fmt.Sprintf("Không thể kết nối tới máy chủ Prometheus: %v", err),
			LatencyMs: latency,
		}, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return &entity.TestConnectionResult{
			Success:   true,
			Message:   fmt.Sprintf("Kết nối thành công (HTTP %d, %dms)", resp.StatusCode, latency),
			LatencyMs: latency,
		}, nil
	}

	return &entity.TestConnectionResult{
		Success:   false,
		Message:   fmt.Sprintf("Prometheus phản hồi mã lỗi HTTP %d", resp.StatusCode),
		LatencyMs: latency,
	}, nil
}

// PushMetricPoint đẩy một điểm đo thực tế mới nhận được từ node heartbeat vào Ring Buffer.
func (s *metricsService) PushMetricPoint(nodeID string, pt entity.NodeMetricPoint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	buf := s.buffers[nodeID]
	buf = append(buf, pt)
	// Giữ tối đa 60 điểm gần nhất (~10 phút nếu gửi 10s/lần)
	if len(buf) > 60 {
		buf = buf[len(buf)-60:]
	}
	s.buffers[nodeID] = buf

	// Đưa vào rollup accumulator cho chu kỳ batch 1 phút
	s.rollupBuckets[nodeID] = append(s.rollupBuckets[nodeID], pt)
}

// GetLatestMetricPoint lấy điểm đo telemetry gần nhất của một node từ In-Memory Ring Buffer.
func (s *metricsService) GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pts, ok := s.buffers[nodeID]
	if !ok || len(pts) == 0 {
		return nil
	}
	latest := pts[len(pts)-1]
	return &latest
}

// GetNodeMetrics trả về danh sách các điểm đo Timeline cho một node:
// - Chế độ 'disabled': Trả về lỗi ErrMetricsDisabled (handler sẽ trả 503).
// - Chế độ 'standalone': Trả về chuỗi điểm đo thực tế từ In-Memory Ring Buffer trong RAM.
// - Chế độ 'prometheus': Gọi API Prometheus; nếu lỗi thì trả về ErrMetricsUnavailable (503).
func (s *metricsService) GetNodeMetrics(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	cfg, err := s.repo.GetMetricsConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("lấy cấu hình metrics thất bại: %w", err)
	}

	// 1. Kiểm tra nếu chế độ đang bị tắt
	if cfg.Mode == "disabled" {
		return nil, taxonomy.ErrMetricsDisabled
	}

	// 2. Chế độ External Prometheus (Production)
	if cfg.Mode == "prometheus" {
		// Gọi Prometheus HTTP API
		queryURL := fmt.Sprintf("%s/api/v1/query?query=up", strings.TrimRight(cfg.PrometheusURL, "/"))
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, queryURL, nil)
		if err != nil {
			return nil, taxonomy.ErrMetricsUnavailable
		}
		resp, err := s.httpClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			if resp != nil {
				resp.Body.Close()
			}
			return nil, taxonomy.ErrMetricsUnavailable
		}
		resp.Body.Close()
	}

	// 3. Trích xuất các điểm đo thực tế từ In-Memory Ring Buffer trong RAM
	s.mu.RLock()
	points, exists := s.buffers[nodeID]
	if exists && len(points) > 0 {
		out := make([]entity.NodeMetricPoint, len(points))
		copy(out, points)
		s.mu.RUnlock()
		return out, nil
	}
	s.mu.RUnlock()

	// 4. Nếu RAM chưa có dữ liệu (ví dụ vừa restart Control Plane), nạp từ lịch sử SQLite
	if s.nodeRepo != nil {
		history, err := s.nodeRepo.GetRecentMetricsHistory(ctx, nodeID, 60)
		if err == nil && len(history) > 0 {
			return history, nil
		}
	}

	return []entity.NodeMetricPoint{}, nil
}

// startRollupWorker khởi chạy background worker gom batch rollup 1 phút và dọn dẹp TTL 7 ngày (kèm pacing + jitter).
func (s *metricsService) startRollupWorker(ctx context.Context) {
	rollupTicker := time.NewTicker(1 * time.Minute)
	go func() {
		defer rollupTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-rollupTicker.C:
				s.flushRollupBatch()
			}
		}
	}()

	// Background cleaner dọn dẹp metrics cũ: chạy mỗi ~1 giờ có thêm random jitter (±5 phút)
	go func() {
		for {
			// Chu kỳ cơ sở 1 giờ + Jitter ngẫu nhiên từ -300s đến +300s (-5m đến +5m)
			jitterSec := rand.Intn(600) - 300
			nextCleanup := time.Duration(3600+jitterSec) * time.Second
			if nextCleanup < 30*time.Minute {
				nextCleanup = 30 * time.Minute
			}

			cleanerTimer := time.NewTimer(nextCleanup)
			select {
			case <-ctx.Done():
				cleanerTimer.Stop()
				return
			case <-cleanerTimer.C:
				if s.nodeRepo != nil {
					// Timeout tối đa 5 phút cho toàn bộ chu trình dọn dẹp
					cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
					_ = s.nodeRepo.CleanupExpiredMetricsHistory(cleanupCtx, 7)
					cancel()
				}
			}
		}
	}()
}

// flushRollupBatch tính toán trung bình các điểm đo trong 1 phút vừa qua và lưu 1 transaction duy nhất xuống SQLite.
func (s *metricsService) flushRollupBatch() {
	if s.nodeRepo == nil {
		return
	}

	s.mu.Lock()
	if len(s.rollupBuckets) == 0 {
		s.mu.Unlock()
		return
	}

	var batch []entity.NodeMetricHistoryRecord
	for nodeID, pts := range s.rollupBuckets {
		if len(pts) == 0 {
			continue
		}
		var totalCPU, totalMem, totalRPS float64
		var maxConns int
		for _, p := range pts {
			totalCPU += p.CPUUsage
			totalMem += p.MemoryUsage
			totalRPS += p.RPS
			if p.ActiveConnections > maxConns {
				maxConns = p.ActiveConnections
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
		delete(s.rollupBuckets, nodeID)
	}
	s.mu.Unlock()

	if len(batch) > 0 {
		_ = s.nodeRepo.BatchInsertMetricsHistory(context.Background(), batch)
	}
}
