package entity

// MetricsIntegrationConfig định nghĩa cấu hình tích hợp nguồn giám sát số liệu (Telemetry).
// Tuân thủ kiến trúc Aurora API Gateway: Flat entity thuần túy trong tầng Domain, tách biệt khỏi transport metadata.
type MetricsIntegrationConfig struct {
	Mode          string // "standalone" | "prometheus" | "disabled"
	PrometheusURL string // Ví dụ: "http://127.0.0.1:9090"
	PrometheusJob string // Ví dụ: "aurora-waf-nodes"
	UpdatedAt     string
}

// NodeMetricPoint đại diện cho một điểm mẫu dữ liệu trên biểu đồ Timeline thời gian thực.
type NodeMetricPoint struct {
	MetricsScope      string
	Timestamp         int64
	TimeLabel         string // Ví dụ: "-60m", "-30m", "Now"
	RPS               float64
	CPUUsage          float64
	MemoryUsage       float64
	ActiveConnections int
}

// TestConnectionResult chứa kết quả kiểm tra kết nối tới máy chủ Prometheus.
type TestConnectionResult struct {
	Success   bool
	Message   string
	LatencyMs int64
}
