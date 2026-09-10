package service

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/provider/catalog"
)

type metricsService struct {
	repo       repo.AnalyticsRepository
	nodeRepo   repo.NodeRepository
	extRepo    repo.ExtensionRepository
	httpClient *http.Client

	// Bảo toàn điểm đo tức thời mới nhất từ nhịp tim (Heartbeat) của từng node cho UI trạng thái
	latestMu     sync.RWMutex
	latestPoints map[string]entity.NodeMetricPoint

	mu             sync.RWMutex
	currentConfig  entity.MetricsIntegrationConfig
	activeProvider provider.MetricsProvider
	closed         bool
	listeners      []func(entity.MetricsIntegrationConfig)
}

// NewMetricsService khởi tạo service quản lý điều phối tích hợp Telemetry và Metrics theo mô hình Strategy.
func NewMetricsService(analyticsRepo repo.AnalyticsRepository, nodeRepo repo.NodeRepository, extRepo ...repo.ExtensionRepository) domainService.MetricsService {
	client := &http.Client{Timeout: 4 * time.Second}
	var er repo.ExtensionRepository
	if len(extRepo) > 0 {
		er = extRepo[0]
	}

	s := &metricsService{
		repo:         analyticsRepo,
		nodeRepo:     nodeRepo,
		extRepo:      er,
		httpClient:   client,
		latestPoints: make(map[string]entity.NodeMetricPoint),
	}

	// Đọc cấu hình khởi đầu từ DB, kích hoạt Provider tương ứng
	cfg, err := analyticsRepo.GetMetricsConfig(context.Background())
	if err != nil || cfg == nil || cfg.Mode == "standalone" {
		cfg = &entity.MetricsIntegrationConfig{
			Mode: "disabled",
		}
	}
	s.currentConfig = *cfg
	s.activeProvider = provider.NewMetricsProvider(*cfg, s.httpClient)
	_ = s.activeProvider.Start(context.Background())

	return s
}

// GetConfig lấy cấu hình tích hợp metrics hiện tại.
func (s *metricsService) GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	return s.repo.GetMetricsConfig(ctx)
}

// SaveConfig thẩm định, lưu cấu hình và chuyển đổi (hot-swap) nguồn thu thập metrics độc quyền.
func (s *metricsService) SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	// 1. Thẩm định mode (loại bỏ hoàn toàn standalone)
	switch cfg.Mode {
	case "prometheus", "disabled":
	case "standalone":
		// Auto-migrate legacy standalone requests to disabled with warning
		cfg.Mode = "disabled"
	default:
		return fmt.Errorf("chế độ metrics không hợp lệ: %s (chỉ chấp nhận 'prometheus', 'disabled')", cfg.Mode)
	}

	// 2. Thẩm định Prometheus URL nếu chọn mode prometheus
	if cfg.Mode == "prometheus" {
		cfg.PrometheusURL = strings.TrimSpace(cfg.PrometheusURL)
		u, err := url.ParseRequestURI(cfg.PrometheusURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("địa chỉ Prometheus URL không hợp lệ: phải bắt đầu bằng http:// hoặc https://")
		}
	}

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
		s.activeProvider = provider.NewMetricsProvider(cfg, s.httpClient)
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

	testProv := provider.NewPrometheusMetricsProvider(targetURL, "test", s.httpClient)
	return testProv.TestConnection(ctx)
}

// PushMetricPoint lưu điểm nhịp tim tức thời mới nhất từ Node Heartbeat vào RAM.
func (s *metricsService) PushMetricPoint(nodeID string, pt entity.NodeMetricPoint) {
	s.latestMu.Lock()
	defer s.latestMu.Unlock()
	if old, ok := s.latestPoints[nodeID]; ok && old.Timestamp >= pt.Timestamp {
		return
	}
	s.latestPoints[nodeID] = pt
}

// GetLatestMetricPoint lấy điểm đo nhịp tim tức thời mới nhất của Node.
func (s *metricsService) GetLatestMetricPoint(nodeID string) *entity.NodeMetricPoint {
	s.latestMu.RLock()
	defer s.latestMu.RUnlock()
	pt, ok := s.latestPoints[nodeID]
	if ok && time.Now().Unix()-pt.Timestamp <= 45 {
		return &pt
	}
	return nil
}

// GetNodeMetrics trích xuất Timeline metrics cho Node từ Active Provider.
func (s *metricsService) GetNodeMetrics(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.activeProvider == nil {
		return []entity.NodeMetricPoint{}, nil
	}
	return s.activeProvider.GetNodeTimeline(ctx, nodeID)
}

// QueryAnalytics thực thi key-driven queries đối với hạ tầng metrics.
func (s *metricsService) QueryAnalytics(ctx context.Context, req entity.AnalyticsQueryRequest) (*entity.AnalyticsQueryResponse, error) {
	startExec := time.Now()

	s.mu.RLock()
	prov := s.activeProvider
	s.mu.RUnlock()

	if prov == nil {
		return nil, taxonomy.ErrMetricsDisabled
	}

	if req.Step <= 0 {
		req.Step = 15
	}
	now := time.Now().Unix()
	if req.End <= 0 {
		req.End = now
	}
	if req.Start <= 0 || req.Start >= req.End {
		req.Start = req.End - 3600
	}

	// Xác định window trượt cho rate() tương ứng với step (tối thiểu 1m hoặc 2*step)
	windowSec := req.Step * 4
	if windowSec < 60 {
		windowSec = 60
	}
	windowStr := fmt.Sprintf("%ds", windowSec)

	var allSeries []entity.AnalyticsSeries

	for _, qItem := range req.Queries {
		promQL, err := catalog.BuildPromQL(qItem, windowStr)
		if err != nil {
			return nil, err
		}

		matrixResp, err := prov.QueryRange(ctx, promQL, req.Start, req.End, req.Step)
		if err != nil {
			return nil, err
		}

		for _, item := range matrixResp.Data.Result {
			var timestamps []int64
			var values []float64

			for _, pair := range item.Values {
				if len(pair) != 2 {
					continue
				}
				tsFloat, ok1 := pair[0].(float64)
				valStr, ok2 := pair[1].(string)
				if !ok1 || !ok2 {
					continue
				}
				valFloat, parseErr := strconv.ParseFloat(valStr, 64)
				if parseErr != nil || math.IsNaN(valFloat) || math.IsInf(valFloat, 0) {
					continue
				}

				timestamps = append(timestamps, int64(tsFloat))
				values = append(values, valFloat)
			}

			// Dọn dẹp metric labels nội bộ
			labels := make(map[string]string)
			for k, v := range item.Metric {
				if k != "__name__" && k != "job" {
					labels[k] = v
				}
			}

			allSeries = append(allSeries, entity.AnalyticsSeries{
				QueryID:    qItem.ID,
				MetricKey:  qItem.MetricKey,
				Labels:     labels,
				Timestamps: timestamps,
				Values:     values,
			})
		}
	}

	return &entity.AnalyticsQueryResponse{
		Series:          allSeries,
		ExecutionTimeMs: time.Since(startExec).Milliseconds(),
		TotalSeries:     len(allSeries),
	}, nil
}

// QueryRaw cho phép thực thi trực tiếp câu PromQL.
func (s *metricsService) QueryRaw(ctx context.Context, req entity.AnalyticsRawQueryRequest) (*entity.AnalyticsQueryResponse, error) {
	startExec := time.Now()

	s.mu.RLock()
	prov := s.activeProvider
	s.mu.RUnlock()

	if prov == nil {
		return nil, taxonomy.ErrMetricsDisabled
	}

	if req.Step <= 0 {
		req.Step = 15
	}
	now := time.Now().Unix()
	if req.End <= 0 {
		req.End = now
	}
	if req.Start <= 0 || req.Start >= req.End {
		req.Start = req.End - 3600
	}

	matrixResp, err := prov.QueryRange(ctx, req.Query, req.Start, req.End, req.Step)
	if err != nil {
		return nil, err
	}

	var allSeries []entity.AnalyticsSeries
	for _, item := range matrixResp.Data.Result {
		var timestamps []int64
		var values []float64

		for _, pair := range item.Values {
			if len(pair) != 2 {
				continue
			}
			tsFloat, ok1 := pair[0].(float64)
			valStr, ok2 := pair[1].(string)
			if !ok1 || !ok2 {
				continue
			}
			valFloat, parseErr := strconv.ParseFloat(valStr, 64)
			if parseErr != nil || math.IsNaN(valFloat) || math.IsInf(valFloat, 0) {
				continue
			}

			timestamps = append(timestamps, int64(tsFloat))
			values = append(values, valFloat)
		}

		labels := make(map[string]string)
		for k, v := range item.Metric {
			if k != "__name__" {
				labels[k] = v
			}
		}

		allSeries = append(allSeries, entity.AnalyticsSeries{
			QueryID:    "raw",
			MetricKey:  req.Query,
			Labels:     labels,
			Timestamps: timestamps,
			Values:     values,
		})
	}

	return &entity.AnalyticsQueryResponse{
		Series:          allSeries,
		ExecutionTimeMs: time.Since(startExec).Milliseconds(),
		TotalSeries:     len(allSeries),
	}, nil
}

// GetCatalog trả về danh mục metrics có khả dụng dựa trên cấu hình extension đang hoạt động.
func (s *metricsService) GetCatalog(ctx context.Context) (*entity.MetricCatalogResponse, error) {
	activeExts := make(map[string]bool)

	if s.extRepo != nil {
		extList, err := s.extRepo.List(ctx, entity.ListExtensionsQuery{})
		if err == nil {
			for _, ext := range extList {
				if ext.Enabled {
					activeExts[ext.ID] = true
				}
			}
		}
	} else {
		// Fallback mặc định bật các core extension
		activeExts["waf_engine"] = true
		activeExts["rate_limit"] = true
		activeExts["prometheus"] = true
	}

	categories := catalog.FilterCategoriesByActiveExtensions(activeExts)

	s.mu.RLock()
	cfg := s.currentConfig
	prov := s.activeProvider
	s.mu.RUnlock()

	status := "disabled"
	if cfg.Mode == "prometheus" {
		status = "connected"
		if prov != nil {
			if testRes, err := prov.TestConnection(ctx); err != nil || (testRes != nil && !testRes.Success) {
				status = "unreachable"
			}
		}
	}

	sources := []entity.TelemetrySourceInfo{
		{
			ID:     "prometheus",
			Name:   "Prometheus / VictoriaMetrics",
			Type:   "prometheus",
			Status: status,
			URL:    cfg.PrometheusURL,
		},
	}

	return &entity.MetricCatalogResponse{
		Sources:    sources,
		Categories: categories,
	}, nil
}

// GetConnectionStatus trích xuất thông tin cấu hình, trạng thái extension và runtime metadata.
func (s *metricsService) GetConnectionStatus(ctx context.Context) (*entity.ConnectionStatusResponse, error) {
	s.mu.RLock()
	cfg := s.currentConfig
	prov := s.activeProvider
	s.mu.RUnlock()

	extensionEnabled := false
	if s.extRepo != nil {
		if ext, err := s.extRepo.GetByID(ctx, "prometheus"); err == nil && ext != nil {
			extensionEnabled = ext.Enabled
		}
	} else {
		extensionEnabled = true
	}

	var meta *entity.RuntimeMetadata
	if prov != nil && cfg.Mode == "prometheus" {
		meta, _ = prov.GetRuntimeMetadata(ctx)
	}

	return &entity.ConnectionStatusResponse{
		ExtensionEnabled: extensionEnabled,
		Config:           cfg,
		Metadata:         meta,
	}, nil
}

// TestConnectionWithConfig thử nghiệm kết nối với cấu hình chi tiết (hỗ trợ TLS/mTLS và Auth).
func (s *metricsService) TestConnectionWithConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) (*entity.TestConnectionResult, error) {
	cfg.PrometheusURL = strings.TrimSpace(cfg.PrometheusURL)
	u, err := url.ParseRequestURI(cfg.PrometheusURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   "Địa chỉ URL không hợp lệ: phải bắt đầu bằng http:// hoặc https://",
			LatencyMs: 0,
		}, nil
	}

	testProv := provider.NewPrometheusMetricsProviderWithConfig(cfg, nil)
	return testProv.TestConnection(ctx)
}

// Close runs after HTTP drain.
func (s *metricsService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if s.activeProvider != nil {
		return s.activeProvider.Stop()
	}
	return nil
}
