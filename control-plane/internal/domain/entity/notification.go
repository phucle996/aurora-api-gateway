package entity

// NotificationChannelItem định nghĩa cấu hình và trạng thái của một kênh thông báo (Email, Slack, Telegram, v.v.).
type NotificationChannelItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Enabled         bool   `json:"enabled"`
	ConfigJSON      string `json:"config_json"`
	LastTestedAt    string `json:"last_tested_at"`
	LastTestStatus  string `json:"last_test_status"` // "success" | "failed" | ""
	LastTestMessage string `json:"last_test_message"`
	UpdatedAt       string `json:"updated_at"`
}

// NotificationRuleItem định nghĩa sự kiện cảnh báo hệ thống (threats, node health, ddos, cert expiry...).
type NotificationRuleItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Severity    string `json:"severity"` // "critical" | "high" | "medium" | "low"
	Enabled     bool   `json:"enabled"`
	UpdatedAt   string `json:"updated_at"`
}

// NotificationOverview là flat projection toàn cảnh trang Notifications Settings.
type NotificationOverview struct {
	Channels []NotificationChannelItem `json:"channels"`
	Rules    []NotificationRuleItem    `json:"rules"`
}

// TestNotificationResult trả về kết quả kiểm tra gửi thông báo thử nghiệm tới kênh.
type TestNotificationResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	LatencyMs int64  `json:"latency_ms"`
}
