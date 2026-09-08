package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
	"context"
	"fmt"
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

	// Bảo toàn điểm đo tức thời mới nhất từ nhịp tim (Heartbeat) của từng node
	latestMu     sync.RWMutex
	latestPoints map[string]entity.NodeMetricPoint

	mu             sync.RWMutex
	currentConfig  entity.MetricsIntegrationConfig
	activeProvider provider.MetricsProvider
	closed         bool
	listeners      []func(entity.MetricsIntegrationConfig)
}

// NewMetricsService khởi tạo service quản lý điều phối tích hợp Telemetry và Metrics theo mô hình Strategy.
func NewMetricsService(repo repo.SettingsRepository, nodeRepo repo.NodeRepository) domainService.MetricsService {
	client := &http.Client{Timeout: 4 * time.Second}
	s := &metricsService{
		repo:         repo,
		nodeRepo:     nodeRepo,
		httpClient:   client,
		latestPoints: make(map[string]entity.NodeMetricPoint),
	}

	// Đọc cấu hình khởi đầu từ DB, kích hoạt Provider tương ứng
	cfg, err := repo.GetMetricsConfig(context.Background())
	if err != nil || cfg == nil {
		cfg = &entity.MetricsIntegrationConfig{
			Mode: "disabled",
		}
	}
	s.currentConfig = *cfg
	s.activeProvider = provider.NewMetricsProvider(*cfg, s.nodeRepo, s.httpClient)
	_ = s.activeProvider.Start(context.Background())

	return s
}

// GetConfig lấy cấu hình tích hợp metrics hiện tại.
func (s *metricsService) GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	return s.repo.GetMetricsConfig(ctx)
}

// SaveConfig thẩm định, lưu cấu hình và chuyển đổi (hot-swap) nguồn thu thập metrics độc quyền.
func (s *metricsService) SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	// 1. Thẩm định mode
	switch cfg.Mode {
	case "standalone", "prometheus", "disabled":
	default:
		return fmt.Errorf("chế độ metrics không hợp lệ: %s (chỉ chấp nhận 'standalone', 'prometheus', 'disabled')", cfg.Mode)
	}

	// 2. Thẩm định Prometheus URL nếu chọn mode prometheus
	if cfg.Mode == "prometheus" {
		cfg.PrometheusURL = strings.TrimSpace(cfg.PrometheusURL)
		u, err := url.ParseRequestURI(cfg.PrometheusURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("địa chỉ Prometheus URL không hợp lệ: phải bắt đầu bằng http:// hoặc https://")
		}
	}

	// One owner serializes durable commit and provider installation. Readers cannot
	// retain an old provider across Stop; HTTP cancellation never owns its lifetime.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("metrics service closed")
	}
	changed := cfg.Mode != s.currentConfig.Mode || cfg.PrometheusURL != s.currentConfig.PrometheusURL || cfg.PrometheusJob != s.currentConfig.PrometheusJob
	if changed && s.activeProvider != nil {
		if err := s.activeProvider.Stop(); err != nil {
			_ = s.activeProvider.Start(context.Background())
			return err
		}
	}
	// 3. Lưu vào repository
	if err := s.repo.SaveMetricsConfig(ctx, cfg); err != nil {
		if changed {
			_ = s.activeProvider.Start(context.Background())
		}
		return err
	}

	// 4. Hot-swap Provider nếu cấu hình thay đổi
	if changed {
		s.activeProvider = provider.NewMetricsProvider(cfg, s.nodeRepo, s.httpClient)
		_ = s.activeProvider.Start(context.Background())
		s.currentConfig = cfg
		for _, listener := range s.listeners {
			listener(cfg)
		}
	}

	return nil
}

// RegisterConfigListener đăng ký hàm nhận thông báo khi cấu hình metrics được cập nhật thành công.
func (s *metricsService) RegisterConfigListener(listener func(entity.MetricsIntegrationConfig)) {
	if listener == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners = append(s.listeners, listener)
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

// PushMetricPoint lưu điểm nhịp tim tức thời mới nhất và chuyển tiếp cho Active Provider xử lý lịch sử.
func (s *metricsService) PushMetricPoint(nodeID string, pt entity.NodeMetricPoint) {
	// 1. Luôn bảo toàn nhịp tim tức thời mới nhất của Node trong RAM
	s.latestMu.Lock()
	if old, ok := s.latestPoints[nodeID]; ok && old.Timestamp >= pt.Timestamp {
		s.latestMu.Unlock()
		return
	}
	s.latestPoints[nodeID] = pt
	s.latestMu.Unlock()

	// 2. Chuyển tiếp tới Active Provider (nếu là standalone thì gom batch rollup/ring buffer, nếu khác thì no-op)
	s.mu.RLock()
	defer s.mu.RUnlock()
	provider := s.activeProvider

	if provider != nil {
		provider.PushMetricPoint(nodeID, pt)
	}
}

// GetLatestMetricPoint lấy điểm đo nhịp tim tức thời mới nhất của Node.
func (s *metricsService) GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint {
	s.latestMu.RLock()
	pt, ok := s.latestPoints[nodeID]
	s.latestMu.RUnlock()
	if ok && time.Now().Unix()-pt.Timestamp <= 45 {
		return &pt
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	provider := s.activeProvider

	if provider != nil {
		return provider.GetLatestMetricPoint(nodeID)
	}
	return nil
}

// GetNodeMetrics trích xuất Timeline metrics cho Node từ Active Provider.
func (s *metricsService) GetNodeMetrics(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	provider := s.activeProvider

	if provider == nil {
		return []entity.NodeMetricPoint{}, nil
	}
	return provider.GetNodeTimeline(ctx, nodeID)
}

// Close runs after HTTP drain and before SQLite pools close.
func (s *metricsService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.activeProvider.Stop()
}
