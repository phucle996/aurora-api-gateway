package provider

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

// PrometheusMatrixResponse phản ánh cấu trúc ma trận trả về từ Prometheus /api/v1/query_range.
type PrometheusMatrixResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Values [][]any           `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

// PrometheusVectorResponse phản ánh cấu trúc vector trả về từ Prometheus /api/v1/query.
type PrometheusVectorResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  []any             `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

// MetricsProvider là interface trừu tượng định nghĩa hợp đồng Query-Only cho hệ thống Telemetry.
// Tuyệt đối không lưu đệm in-memory hay đóng vai trò collector trong Control Plane.
type MetricsProvider interface {
	GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error)
	QueryRange(ctx context.Context, query string, start, end int64, step int) (*PrometheusMatrixResponse, error)
	QueryInstant(ctx context.Context, query string) (*PrometheusVectorResponse, error)
	TestConnection(ctx context.Context) (*entity.TestConnectionResult, error)
	GetRuntimeMetadata(ctx context.Context) (*entity.RuntimeMetadata, error)
	Start(ctx context.Context) error
	Stop() error
}

// NewMetricsProvider khởi tạo provider thích ứng dựa trên cấu hình ("prometheus", "disabled").
func NewMetricsProvider(cfg entity.MetricsIntegrationConfig, client *http.Client) MetricsProvider {
	switch cfg.Mode {
	case "prometheus":
		return NewPrometheusMetricsProviderWithConfig(cfg, client)
	case "disabled":
		return NewDisabledMetricsProvider()
	default:
		return NewDisabledMetricsProvider()
	}
}

// ─── Prometheus Provider (External Prometheus / VictoriaMetrics PromQL) ────

type PrometheusMetricsProvider struct {
	cfg        entity.MetricsIntegrationConfig
	promURL    string
	jobName    string
	httpClient *http.Client
}

// NewPrometheusMetricsProvider khởi tạo provider truy vấn Prometheus qua HTTP PromQL.
func NewPrometheusMetricsProvider(promURL, jobName string, client *http.Client) *PrometheusMetricsProvider {
	cfg := entity.MetricsIntegrationConfig{
		Mode:          "prometheus",
		PrometheusURL: promURL,
		PrometheusJob: jobName,
	}
	return NewPrometheusMetricsProviderWithConfig(cfg, client)
}

// NewPrometheusMetricsProviderWithConfig khởi tạo provider với hỗ trợ toàn diện TLS/mTLS và Auth.
func NewPrometheusMetricsProviderWithConfig(cfg entity.MetricsIntegrationConfig, client *http.Client) *PrometheusMetricsProvider {
	if client == nil {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: cfg.InsecureSkip,
		}

		if cfg.CACertPEM != "" {
			caPool := x509.NewCertPool()
			if caPool.AppendCertsFromPEM([]byte(cfg.CACertPEM)) {
				tlsConfig.RootCAs = caPool
			}
		}

		if cfg.ClientCertPEM != "" && cfg.ClientKeyPEM != "" {
			cert, err := tls.X509KeyPair([]byte(cfg.ClientCertPEM), []byte(cfg.ClientKeyPEM))
			if err == nil {
				tlsConfig.Certificates = []tls.Certificate{cert}
			}
		}

		transport := &http.Transport{
			TLSClientConfig:     tlsConfig,
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
		}

		client = &http.Client{
			Timeout:   4 * time.Second,
			Transport: transport,
		}
	}

	return &PrometheusMetricsProvider{
		cfg:        cfg,
		promURL:    strings.TrimRight(strings.TrimSpace(cfg.PrometheusURL), "/"),
		jobName:    strings.TrimSpace(cfg.PrometheusJob),
		httpClient: client,
	}
}

func (p *PrometheusMetricsProvider) Start(context.Context) error { return nil }
func (p *PrometheusMetricsProvider) Stop() error                 { return nil }

func (p *PrometheusMetricsProvider) prepareRequest(ctx context.Context, method, targetURL string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, targetURL, body)
	if err != nil {
		return nil, err
	}

	if p.cfg.AuthType == "bearer" && p.cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+p.cfg.AuthToken)
	} else if p.cfg.AuthType == "basic" && p.cfg.AuthUsername != "" {
		req.SetBasicAuth(p.cfg.AuthUsername, p.cfg.AuthPassword)
	}

	for k, v := range p.cfg.CustomHeaders {
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if k != "" && v != "" {
			req.Header.Set(k, v)
		}
	}

	return req, nil
}

// TestConnection kiểm tra kết nối và trích xuất Metadata thời gian thực.
func (p *PrometheusMetricsProvider) TestConnection(ctx context.Context) (*entity.TestConnectionResult, error) {
	if p.promURL == "" {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   "Chưa cấu hình URL Prometheus",
			LatencyMs: 0,
		}, nil
	}

	meta, err := p.GetRuntimeMetadata(ctx)
	if err != nil {
		return &entity.TestConnectionResult{
			Success:   false,
			Message:   fmt.Sprintf("Không thể kết nối máy chủ metrics: %v", err),
			LatencyMs: 0,
			Metadata:  meta,
		}, nil
	}

	return &entity.TestConnectionResult{
		Success:   true,
		Message:   fmt.Sprintf("Kết nối thành công tới %s (%dms, %d targets UP)", meta.Engine, meta.LatencyMs, meta.ActiveTargets),
		LatencyMs: meta.LatencyMs,
		Metadata:  meta,
	}, nil
}

// GetRuntimeMetadata thu thập thông tin phiên bản, độ trễ và số lượng targets đang giám sát.
func (p *PrometheusMetricsProvider) GetRuntimeMetadata(ctx context.Context) (*entity.RuntimeMetadata, error) {
	if p.promURL == "" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	start := time.Now()
	probeURL := fmt.Sprintf("%s/api/v1/query?query=up", p.promURL)
	req, err := p.prepareRequest(ctx, http.MethodGet, probeURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := p.httpClient.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return &entity.RuntimeMetadata{
			Status:        "unreachable",
			LatencyMs:     latency,
			LastCheckedAt: time.Now().Unix(),
			ErrorMessage:  err.Error(),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &entity.RuntimeMetadata{
			Status:        "unreachable",
			LatencyMs:     latency,
			LastCheckedAt: time.Now().Unix(),
			ErrorMessage:  fmt.Sprintf("HTTP %d", resp.StatusCode),
		}, taxonomy.ErrMetricsUnavailable
	}

	engine := "Prometheus"
	version := "v2.x"
	revision := ""
	activeTargets := 0
	totalTargets := 0

	// 1. Thử probe /api/v1/status/buildinfo để lấy thông tin phiên bản chi tiết
	buildInfoURL := fmt.Sprintf("%s/api/v1/status/buildinfo", p.promURL)
	if bReq, bErr := p.prepareRequest(ctx, http.MethodGet, buildInfoURL, nil); bErr == nil {
		if bResp, bDoErr := p.httpClient.Do(bReq); bDoErr == nil {
			defer bResp.Body.Close()
			if bResp.StatusCode == http.StatusOK {
				var bi struct {
					Status string `json:"status"`
					Data   struct {
						Version  string `json:"version"`
						Revision string `json:"revision"`
					} `json:"data"`
				}
				if jsonErr := json.NewDecoder(io.LimitReader(bResp.Body, 128*1024)).Decode(&bi); jsonErr == nil && bi.Status == "success" {
					if bi.Data.Version != "" {
						version = bi.Data.Version
					}
					revision = bi.Data.Revision
				}
			}
		}
	}

	// 2. Thử probe /api/v1/targets để thống kê targets
	targetsURL := fmt.Sprintf("%s/api/v1/targets", p.promURL)
	if tReq, tErr := p.prepareRequest(ctx, http.MethodGet, targetsURL, nil); tErr == nil {
		if tResp, tDoErr := p.httpClient.Do(tReq); tDoErr == nil {
			defer tResp.Body.Close()
			if tResp.StatusCode == http.StatusOK {
				var targetsData struct {
					Status string `json:"status"`
					Data   struct {
						ActiveTargets []struct {
							Health string `json:"health"`
						} `json:"activeTargets"`
					} `json:"data"`
				}
				if jsonErr := json.NewDecoder(io.LimitReader(tResp.Body, 1024*1024)).Decode(&targetsData); jsonErr == nil && targetsData.Status == "success" {
					totalTargets = len(targetsData.Data.ActiveTargets)
					for _, at := range targetsData.Data.ActiveTargets {
						if strings.EqualFold(at.Health, "up") {
							activeTargets++
						}
					}
				}
			}
		}
	}

	return &entity.RuntimeMetadata{
		Engine:        engine,
		Version:       version,
		Revision:      revision,
		LatencyMs:     latency,
		ActiveTargets: activeTargets,
		TotalTargets:  totalTargets,
		Status:        "connected",
		LastCheckedAt: time.Now().Unix(),
	}, nil
}

// QueryRange thực thi PromQL dải thời gian /api/v1/query_range.
func (p *PrometheusMetricsProvider) QueryRange(ctx context.Context, query string, start, end int64, step int) (*PrometheusMatrixResponse, error) {
	if p.promURL == "" {
		return nil, taxonomy.ErrMetricsUnavailable
	}
	if step <= 0 {
		step = 15
	}
	if end <= 0 {
		end = time.Now().Unix()
	}
	if start <= 0 || start >= end {
		start = end - 3600
	}

	u := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=%d",
		p.promURL,
		url.QueryEscape(query),
		start, end, step)

	req, err := p.prepareRequest(ctx, http.MethodGet, u, nil)
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

	data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(data) > 8*1024*1024 {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	var promResp PrometheusMatrixResponse
	if err := json.Unmarshal(data, &promResp); err != nil || promResp.Status != "success" || promResp.Data.ResultType != "matrix" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	return &promResp, nil
}

// QueryInstant thực thi PromQL tức thời /api/v1/query.
func (p *PrometheusMetricsProvider) QueryInstant(ctx context.Context, query string) (*PrometheusVectorResponse, error) {
	if p.promURL == "" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	u := fmt.Sprintf("%s/api/v1/query?query=%s", p.promURL, url.QueryEscape(query))
	req, err := p.prepareRequest(ctx, http.MethodGet, u, nil)
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

	data, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
	if err != nil || len(data) > 4*1024*1024 {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	var promResp PrometheusVectorResponse
	if err := json.Unmarshal(data, &promResp); err != nil || promResp.Status != "success" || promResp.Data.ResultType != "vector" {
		return nil, taxonomy.ErrMetricsUnavailable
	}

	return &promResp, nil
}

// GetNodeTimeline trích xuất Timeline 4 chỉ số cơ bản của Node (phục vụ tương thích ngược).
func (p *PrometheusMetricsProvider) GetNodeTimeline(ctx context.Context, nodeID string) ([]entity.NodeMetricPoint, error) {
	now := time.Now().Unix()
	start := now - 3600
	step := 15

	query := fmt.Sprintf(`{__name__=~"system_cpu_utilization_ratio|system_memory_utilization_ratio|http_connections_active|http_requests_per_second|aurora_node_cpu_percent|aurora_node_memory_percent|aurora_node_active_connections|aurora_node_requests_per_second",node_id=%s,job=%s}`, strconv.Quote(nodeID), strconv.Quote(p.jobName))
	promResp, err := p.QueryRange(ctx, query, start, now, step)
	if err != nil {
		return nil, err
	}
	if len(promResp.Data.Result) == 0 {
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

// ─── Disabled Provider ────────────────────────────────────────────────────────

type DisabledMetricsProvider struct{}

func NewDisabledMetricsProvider() *DisabledMetricsProvider {
	return &DisabledMetricsProvider{}
}

func (p *DisabledMetricsProvider) Start(context.Context) error { return nil }
func (p *DisabledMetricsProvider) Stop() error                 { return nil }
func (p *DisabledMetricsProvider) QueryRange(context.Context, string, int64, int64, int) (*PrometheusMatrixResponse, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
func (p *DisabledMetricsProvider) QueryInstant(context.Context, string) (*PrometheusVectorResponse, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
func (p *DisabledMetricsProvider) TestConnection(context.Context) (*entity.TestConnectionResult, error) {
	return &entity.TestConnectionResult{
		Success:   false,
		Message:   "Dịch vụ Metrics đang bị vô hiệu hóa",
		LatencyMs: 0,
	}, nil
}
func (p *DisabledMetricsProvider) GetRuntimeMetadata(context.Context) (*entity.RuntimeMetadata, error) {
	return &entity.RuntimeMetadata{
		Status:        "disabled",
		LatencyMs:     0,
		LastCheckedAt: time.Now().Unix(),
	}, nil
}
func (p *DisabledMetricsProvider) GetNodeTimeline(context.Context, string) ([]entity.NodeMetricPoint, error) {
	return nil, taxonomy.ErrMetricsDisabled
}
