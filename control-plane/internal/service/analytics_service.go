package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/provider/catalog"
)

type analyticsService struct {
	repo       repo.AnalyticsRepository
	extRepo    repo.ExtensionRepository
	httpClient *http.Client

	mu             sync.RWMutex
	currentConfig  entity.MetricsIntegrationConfig
	activeProvider provider.MetricsProvider
	closed         bool
	listeners      []func(entity.MetricsIntegrationConfig)
}

// NewAnalyticsService khởi tạo service phân tích số liệu (Query-Only Semantic Analytics Engine).
func NewAnalyticsService(analyticsRepo repo.AnalyticsRepository, extRepo ...repo.ExtensionRepository) domainService.AnalyticsService {
	client := &http.Client{Timeout: 5 * time.Second}
	var er repo.ExtensionRepository
	if len(extRepo) > 0 {
		er = extRepo[0]
	}

	s := &analyticsService{
		repo:       analyticsRepo,
		extRepo:    er,
		httpClient: client,
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

	return s
}

func (s *analyticsService) GetConfig(ctx context.Context) (*entity.MetricsIntegrationConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfgCopy := s.currentConfig
	return &cfgCopy, nil
}

func (s *analyticsService) SaveConnectionConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	return s.SaveConfig(ctx, cfg)
}

func (s *analyticsService) SaveConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) error {
	if cfg.Mode != "prometheus" && cfg.Mode != "disabled" {
		return fmt.Errorf("chế độ telemetry không hợp lệ: %s (chỉ hỗ trợ prometheus hoặc disabled)", cfg.Mode)
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return errors.New("service đã bị đóng")
	}

	// 1. Lưu bền vững vào SQLite
	if err := s.repo.SaveMetricsConfig(ctx, cfg); err != nil {
		s.mu.Unlock()
		return fmt.Errorf("lưu cấu hình telemetry thất bại: %w", err)
	}

	// 2. Dừng provider cũ và khởi động provider mới
	if s.activeProvider != nil {
		_ = s.activeProvider.Stop()
	}

	s.currentConfig = cfg
	s.activeProvider = provider.NewMetricsProvider(cfg, s.httpClient)
	listeners := append([]func(entity.MetricsIntegrationConfig){}, s.listeners...)
	s.mu.Unlock()

	// 3. Báo cho các listener (ví dụ: RateLimit Collector)
	for _, l := range listeners {
		l(cfg)
	}

	return nil
}

func (s *analyticsService) RegisterConfigListener(listener func(cfg entity.MetricsIntegrationConfig)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners = append(s.listeners, listener)
}

// Query thực thi truy vấn metrics theo key-driven contract có bảo vệ Query Guard và tự động tối ưu hóa step.
func (s *analyticsService) Query(ctx context.Context, req entity.AnalyticsQueryRequest) (*entity.AnalyticsQueryResponse, error) {
	s.mu.RLock()
	mode := s.currentConfig.Mode
	prov := s.activeProvider
	s.mu.RUnlock()

	if mode == "disabled" {
		return nil, taxonomy.ErrMetricsDisabled
	}
	if prov == nil {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	// ─── Query Guard & Time Range Validation ───
	now := time.Now().Unix()
	if req.Start <= 0 {
		req.Start = now - 3600 // Mặc định 1 giờ trước
	}
	if req.End <= 0 {
		req.End = now
	}
	if req.End <= req.Start {
		return nil, errors.New("thời gian kết thúc (end) phải lớn hơn thời gian bắt đầu (start)")
	}

	timeDiff := req.End - req.Start
	if timeDiff > 90*86400 {
		return nil, errors.New("khoảng thời gian truy vấn vượt quá giới hạn tối đa 90 ngày")
	}

	// Tự động tính step nếu chưa truyền hoặc quá nhỏ để chống OOM/DoS máy chủ TSDB
	if req.Step <= 0 {
		req.Step = int(timeDiff / 300)
		if req.Step < 15 {
			req.Step = 15
		}
	} else if req.Step < 5 {
		req.Step = 5
	}
	// Giới hạn tối đa 1000 data points trên mỗi series
	if int(timeDiff)/req.Step > 1000 {
		req.Step = int(timeDiff / 1000)
	}

	startTime := time.Now()
	var allSeries []entity.AnalyticsSeries

	for _, q := range req.Queries {
		promQL, err := catalog.BuildPromQL(q, "1m")
		if err != nil {
			return nil, fmt.Errorf("query [%s] không hợp lệ: %w", q.ID, err)
		}

		matrix, err := prov.QueryRange(ctx, promQL, req.Start, req.End, req.Step)
		if err != nil {
			return nil, fmt.Errorf("truy vấn hạ tầng metrics thất bại cho query [%s]: %w", q.ID, err)
		}

		for _, item := range matrix.Data.Result {
			var timestamps []int64
			var values []float64

			for _, pair := range item.Values {
				if len(pair) < 2 {
					continue
				}
				tsFloat, ok1 := pair[0].(float64)
				valStr, ok2 := pair[1].(string)
				if !ok1 || !ok2 {
					continue
				}

				var v float64
				_, _ = fmt.Sscanf(valStr, "%f", &v)

				timestamps = append(timestamps, int64(tsFloat))
				values = append(values, v)
			}

			allSeries = append(allSeries, entity.AnalyticsSeries{
				QueryID:    q.ID,
				MetricKey:  q.MetricKey,
				Labels:     item.Metric,
				Timestamps: timestamps,
				Values:     values,
			})
		}
	}

	return &entity.AnalyticsQueryResponse{
		Series:          allSeries,
		ExecutionTimeMs: time.Since(startTime).Milliseconds(),
		TotalSeries:     len(allSeries),
	}, nil
}

// QueryRaw thực thi trực tiếp câu PromQL cho Power-User.
func (s *analyticsService) QueryRaw(ctx context.Context, req entity.AnalyticsRawQueryRequest) (*entity.AnalyticsQueryResponse, error) {
	s.mu.RLock()
	mode := s.currentConfig.Mode
	prov := s.activeProvider
	s.mu.RUnlock()

	if mode == "disabled" {
		return nil, taxonomy.ErrMetricsDisabled
	}
	if prov == nil {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	now := time.Now().Unix()
	if req.Start <= 0 {
		req.Start = now - 3600
	}
	if req.End <= 0 {
		req.End = now
	}
	if req.End <= req.Start {
		return nil, errors.New("thời gian kết thúc phải lớn hơn thời gian bắt đầu")
	}

	timeDiff := req.End - req.Start
	if req.Step <= 0 {
		req.Step = int(timeDiff / 300)
		if req.Step < 15 {
			req.Step = 15
		}
	} else if req.Step < 5 {
		req.Step = 5
	}
	if int(timeDiff)/req.Step > 1000 {
		req.Step = int(timeDiff / 1000)
	}

	startTime := time.Now()
	matrix, err := prov.QueryRange(ctx, req.Query, req.Start, req.End, req.Step)
	if err != nil {
		return nil, fmt.Errorf("thực thi raw query thất bại: %w", err)
	}

	var allSeries []entity.AnalyticsSeries
	for _, item := range matrix.Data.Result {
		var timestamps []int64
		var values []float64

		for _, pair := range item.Values {
			if len(pair) < 2 {
				continue
			}
			tsFloat, ok1 := pair[0].(float64)
			valStr, ok2 := pair[1].(string)
			if !ok1 || !ok2 {
				continue
			}

			var v float64
			_, _ = fmt.Sscanf(valStr, "%f", &v)

			timestamps = append(timestamps, int64(tsFloat))
			values = append(values, v)
		}

		allSeries = append(allSeries, entity.AnalyticsSeries{
			QueryID:    "raw",
			MetricKey:  "raw_promql",
			Labels:     item.Metric,
			Timestamps: timestamps,
			Values:     values,
		})
	}

	return &entity.AnalyticsQueryResponse{
		Series:          allSeries,
		ExecutionTimeMs: time.Since(startTime).Milliseconds(),
		TotalSeries:     len(allSeries),
	}, nil
}

// GetCatalog trả về danh mục metrics động và danh sách sources khả dụng.
func (s *analyticsService) GetCatalog(ctx context.Context) (*entity.MetricCatalogResponse, error) {
	s.mu.RLock()
	cfg := s.currentConfig
	s.mu.RUnlock()

	var sources []entity.TelemetrySourceInfo

	promStatus := "disabled"
	if cfg.Mode == "prometheus" {
		promStatus = "connected"
	}
	sources = append(sources, entity.TelemetrySourceInfo{
		ID:     "prometheus",
		Name:   "Prometheus / Mimir TSDB",
		Type:   "prometheus",
		Status: promStatus,
		URL:    cfg.PrometheusURL,
	})

	if s.extRepo != nil {
		exts, err := s.extRepo.List(ctx, entity.ListExtensionsQuery{})
		if err == nil {
			for _, ext := range exts {
				if ext.Category == "telemetry" || ext.Category == "monitoring" {
					status := "disabled"
					if ext.Enabled {
						status = "connected"
					}
					sources = append(sources, entity.TelemetrySourceInfo{
						ID:     ext.ID,
						Name:   ext.Name,
						Type:   ext.Category,
						Status: status,
					})
				}
			}
		}
	}

	return &entity.MetricCatalogResponse{
		Sources:    sources,
		Categories: catalog.DefaultCategories(),
	}, nil
}

// GetConnectionStatus trả về cấu hình hiện tại kèm trạng thái extension telemetry và runtime metadata.
func (s *analyticsService) GetConnectionStatus(ctx context.Context) (*entity.ConnectionStatusResponse, error) {
	s.mu.RLock()
	cfg := s.currentConfig
	prov := s.activeProvider
	s.mu.RUnlock()

	extEnabled := true
	if s.extRepo != nil {
		ext, err := s.extRepo.GetByID(ctx, "prometheus_metrics")
		if err == nil && ext != nil {
			extEnabled = ext.Enabled
		}
	}

	var meta *entity.RuntimeMetadata
	if prov != nil && cfg.Mode == "prometheus" {
		meta, _ = prov.GetRuntimeMetadata(ctx)
	}

	return &entity.ConnectionStatusResponse{
		ExtensionEnabled: extEnabled,
		Config:           cfg,
		Metadata:         meta,
	}, nil
}

// TestConnectionWithConfig kiểm tra kết nối tới máy chủ Telemetry kèm runtime metadata probing.
func (s *analyticsService) TestConnectionWithConfig(ctx context.Context, cfg entity.MetricsIntegrationConfig) (*entity.TestConnectionResult, error) {
	if cfg.Mode != "prometheus" {
		return &entity.TestConnectionResult{
			Success: true,
			Message: "Telemetry đang ở chế độ tắt (disabled)",
		}, nil
	}

	tempProv := provider.NewPrometheusMetricsProviderWithConfig(cfg, s.httpClient)
	return tempProv.TestConnection(ctx)
}

func (s *analyticsService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.activeProvider != nil {
		return s.activeProvider.Stop()
	}
	return nil
}
