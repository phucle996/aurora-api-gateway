package entity

// MetricsIntegrationConfig định nghĩa cấu hình tích hợp nguồn giám sát số liệu (Telemetry).
// Tuân thủ kiến trúc Aurora WAF: Flat entity, tách bạch giữa chế độ Lab/Standalone và Production.
type MetricsIntegrationConfig struct {
	Mode          string `json:"mode"`           // "standalone" | "prometheus" | "disabled"
	PrometheusURL string `json:"prometheus_url"` // Ví dụ: "http://127.0.0.1:9090"
	PrometheusJob string `json:"prometheus_job"` // Ví dụ: "aurora-waf-nodes"
	UpdatedAt     string `json:"updated_at"`
}

// NodeMetricPoint đại diện cho một điểm mẫu dữ liệu trên biểu đồ Timeline thời gian thực.
type NodeMetricPoint struct {
	Timestamp         int64   `json:"timestamp"`
	TimeLabel         string  `json:"timeLabel"` // Ví dụ: "-60m", "-30m", "Now"
	RPS               float64 `json:"rps"`
	CPUUsage          float64 `json:"cpuUsage"`
	MemoryUsage       float64 `json:"memoryUsage"`
	ActiveConnections int     `json:"activeConnections"`
}

// TestConnectionResult chứa kết quả kiểm tra kết nối tới máy chủ Prometheus.
type TestConnectionResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	LatencyMs int64  `json:"latency_ms"`
}
