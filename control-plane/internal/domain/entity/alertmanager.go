package entity

// AlertmanagerSettings lưu cấu hình tích hợp với cụm Alertmanager & Prometheus.
type AlertmanagerSettings struct {
	Enabled         bool   `json:"enabled"`
	AlertmanagerURL string `json:"alertmanager_url"`
	PrometheusURL   string `json:"prometheus_url"`
	UpdatedAt       string `json:"updated_at"`
}

// PrometheusRuleItem phản ánh một quy tắc cảnh báo từ Prometheus Rules API (/api/v1/rules).
type PrometheusRuleItem struct {
	Name         string                  `json:"name"`
	Group        string                  `json:"group"`
	Query        string                  `json:"query"`
	Duration     string                  `json:"duration"`
	Severity     string                  `json:"severity"`
	State        string                  `json:"state"` // "firing", "pending", "inactive"
	Health       string                  `json:"health"`
	LastError    string                  `json:"last_error,omitempty"`
	Labels       map[string]string       `json:"labels"`
	Annotations  map[string]string       `json:"annotations"`
	ActiveAlerts []PrometheusActiveAlert `json:"active_alerts,omitempty"`
}

// PrometheusActiveAlert thể hiện một instance cảnh báo đang kích hoạt.
type PrometheusActiveAlert struct {
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	State       string            `json:"state"`
	ActiveAt    string            `json:"active_at"`
	Value       string            `json:"value"`
}

// AlertmanagerMatcher định nghĩa bộ lọc nhãn của silence.
type AlertmanagerMatcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsRegex bool   `json:"isRegex"`
	IsEqual bool   `json:"isEqual"`
}

// AlertmanagerSilenceItem đại diện cho một khoảng lặng (mute) trên Alertmanager.
type AlertmanagerSilenceItem struct {
	ID        string                `json:"id"`
	Status    string                `json:"status"` // "active", "pending", "expired"
	StartsAt  string                `json:"starts_at"`
	EndsAt    string                `json:"ends_at"`
	CreatedBy string                `json:"created_by"`
	Comment   string                `json:"comment"`
	Matchers  []AlertmanagerMatcher `json:"matchers"`
}

// AlertmanagerReceiverItem đại diện cho kênh đích trong Alertmanager.
type AlertmanagerReceiverItem struct {
	Name string `json:"name"`
}

// AlertmanagerOverview tổng hợp tình trạng sức khỏe kết nối và thống kê cảnh báo.
type AlertmanagerOverview struct {
	PrometheusConnected   bool   `json:"prometheus_connected"`
	PrometheusLatencyMs   int64  `json:"prometheus_latency_ms"`
	AlertmanagerConnected bool   `json:"alertmanager_connected"`
	AlertmanagerLatencyMs int64  `json:"alertmanager_latency_ms"`
	ActiveAlertsCount     int    `json:"active_alerts_count"`
	ActiveSilencesCount   int    `json:"active_silences_count"`
	TotalRulesCount       int    `json:"total_rules_count"`
	PrometheusURL         string `json:"prometheus_url"`
	AlertmanagerURL       string `json:"alertmanager_url"`
}
