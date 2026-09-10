package entity

// AnalyticsQueryItem biểu diễn một truy vấn metric đơn lẻ trong một batch query (ví dụ: Query A, Query B).
type AnalyticsQueryItem struct {
	ID          string            `json:"id"`                     // Ví dụ: "A", "B"
	MetricKey   string            `json:"metric_key"`            // Ví dụ: "traffic.requests_rate", "waf.blocks_rate"
	Aggregation string            `json:"aggregation,omitempty"` // "sum", "avg", "max", "min"
	Filters     map[string]string `json:"filters,omitempty"`     // node_id, status, domain, etc.
	GroupBy     []string          `json:"group_by,omitempty"`    // status, node_id, action
}

// AnalyticsQueryRequest là payload yêu cầu truy vấn metrics đa chiều từ Client.
type AnalyticsQueryRequest struct {
	SourceID string               `json:"source_id"` // "prometheus" hoặc ID của extension telemetry
	Queries  []AnalyticsQueryItem `json:"queries"`
	Start    int64                `json:"start"`        // Unix timestamp (giây)
	End      int64                `json:"end"`          // Unix timestamp (giây)
	Step     int                  `json:"step_seconds"` // Bước nhảy (giây), mặc định 15s
}

// AnalyticsRawQueryRequest cho phép power-user thực thi trực tiếp câu PromQL.
type AnalyticsRawQueryRequest struct {
	SourceID string `json:"source_id"`
	Query    string `json:"query"`
	Start    int64  `json:"start"`
	End      int64  `json:"end"`
	Step     int    `json:"step_seconds"`
}

// AnalyticsSeriesPoint là một chuỗi thời gian kết quả trả về cho Client.
type AnalyticsSeries struct {
	QueryID    string            `json:"query_id"`
	MetricKey  string            `json:"metric_key"`
	Labels     map[string]string `json:"labels"`
	Timestamps []int64           `json:"timestamps"`
	Values     []float64         `json:"values"`
}

// AnalyticsQueryResponse là cấu trúc phản hồi chuẩn hóa cho Frontend.
type AnalyticsQueryResponse struct {
	Series          []AnalyticsSeries `json:"series"`
	ExecutionTimeMs int64             `json:"execution_time_ms"`
	TotalSeries     int               `json:"total_series"`
}

// MetricDefinition định nghĩa siêu dữ liệu cho từng Metric Key trong Catalog.
type MetricDefinition struct {
	Key                   string   `json:"key"`
	Name                  string   `json:"name"`
	Unit                  string   `json:"unit"`
	Description           string   `json:"description"`
	SupportedAggregations []string `json:"supported_aggregations"`
	SupportedGroupBy      []string `json:"supported_group_by"`
	ExtensionRequired     string   `json:"extension_required,omitempty"`
	PromQLTemplate        string   `json:"promql_template"`
}

// MetricCatalogCategory phân nhóm các metric key theo nghiệp vụ.
type MetricCatalogCategory struct {
	ID                string             `json:"id"`
	Name              string             `json:"name"`
	Description       string             `json:"description"`
	ExtensionRequired string             `json:"extension_required,omitempty"`
	Metrics           []MetricDefinition `json:"metrics"`
}

// TelemetrySourceInfo định nghĩa nguồn telemetry đang khả dụng.
type TelemetrySourceInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Status string `json:"status"` // "connected", "unreachable", "disabled"
	URL    string `json:"url,omitempty"`
}

// MetricCatalogResponse trả về danh mục metrics động cho Frontend.
type MetricCatalogResponse struct {
	Sources    []TelemetrySourceInfo   `json:"sources"`
	Categories []MetricCatalogCategory `json:"categories"`
}

// RuntimeMetadata phản ánh dữ liệu trạng thái thời gian thực của máy chủ Telemetry.
type RuntimeMetadata struct {
	Engine        string `json:"engine"`          // "Prometheus", "VictoriaMetrics", "OpenTelemetry"
	Version       string `json:"version"`         // Ví dụ: "v2.51.0"
	Revision      string `json:"revision,omitempty"`
	LatencyMs     int64  `json:"latency_ms"`      // Roundtrip latency
	ActiveTargets int    `json:"active_targets"`  // Số targets/nodes đang UP
	TotalTargets  int    `json:"total_targets"`   // Tổng số targets phát hiện
	Status        string `json:"status"`          // "connected", "unreachable", "disabled"
	LastCheckedAt int64  `json:"last_checked_at"` // Unix timestamp
	ErrorMessage  string `json:"error_message,omitempty"`
}

// MetricsIntegrationConfig định nghĩa cấu hình tích hợp nguồn giám sát số liệu (Telemetry).
// Hỗ trợ kết nối bảo mật Doanh nghiệp (Enterprise): Token, Basic Auth, TLS tuỳ chỉnh và mTLS hai chiều.
type MetricsIntegrationConfig struct {
	Mode          string `json:"mode"`           // "prometheus" | "disabled"
	PrometheusURL string `json:"prometheus_url"` // Ví dụ: "https://127.0.0.1:9090"
	PrometheusJob string `json:"prometheus_job"` // Ví dụ: "aurora-waf-nodes"

	// Authentication
	AuthType      string            `json:"auth_type,omitempty"`      // "none" | "bearer" | "basic" | "headers"
	AuthToken     string            `json:"auth_token,omitempty"`     // Bearer Token
	AuthUsername  string            `json:"auth_username,omitempty"`  // Basic Auth Username
	AuthPassword  string            `json:"auth_password,omitempty"`  // Basic Auth Password
	CustomHeaders map[string]string `json:"custom_headers,omitempty"` // Header bổ sung (vd: X-Scope-OrgID cho Mimir)

	// TLS & mTLS Security
	TLSEnabled    bool   `json:"tls_enabled,omitempty"`     // Bật mã hoá TLS
	InsecureSkip  bool   `json:"insecure_skip,omitempty"`   // Bỏ qua xác thực chứng chỉ (Lab/Self-Signed)
	CACertPEM     string `json:"ca_cert_pem,omitempty"`     // Root CA Certificate PEM
	ClientCertPEM string `json:"client_cert_pem,omitempty"` // Client Certificate PEM (mTLS)
	ClientKeyPEM  string `json:"client_key_pem,omitempty"`  // Client Private Key PEM (mTLS)

	UpdatedAt string `json:"updated_at,omitempty"`
}

// NodeMetricPoint đại diện cho một điểm mẫu dữ liệu trên biểu đồ Timeline thời gian thực.
type NodeMetricPoint struct {
	MetricsScope      string  `json:"metricsScope"`
	Timestamp         int64   `json:"timestamp"`
	TimeLabel         string  `json:"timeLabel"` // Ví dụ: "-60m", "-30m", "Now"
	RPS               float64 `json:"rps"`
	CPUUsage          float64 `json:"cpuUsage"`
	MemoryUsage       float64 `json:"memoryUsage"`
	ActiveConnections int     `json:"activeConnections"`
}

// TestConnectionResult chứa kết quả kiểm tra kết nối tới máy chủ Prometheus.
type TestConnectionResult struct {
	Success   bool             `json:"success"`
	Message   string           `json:"message"`
	LatencyMs int64            `json:"latency_ms"`
	Metadata  *RuntimeMetadata `json:"metadata,omitempty"`
}

// ConnectionStatusResponse gói toàn bộ cấu hình, trạng thái extension và runtime metadata.
type ConnectionStatusResponse struct {
	ExtensionEnabled bool                     `json:"extension_enabled"`
	Config           MetricsIntegrationConfig `json:"config"`
	Metadata         *RuntimeMetadata         `json:"metadata,omitempty"`
}

