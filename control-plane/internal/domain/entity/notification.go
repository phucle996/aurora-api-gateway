package entity

// Tuân thủ Flat Entity: không chứa json tags.

// NotificationChannelItem định nghĩa cấu hình và trạng thái của một kênh thông báo (Email, Slack, Telegram, v.v.).
type NotificationChannelItem struct {
	ID              string
	Name            string
	Description     string
	Enabled         bool
	ConfigJSON      string
	LastTestedAt    string
	LastTestStatus  string // "success" | "failed" | ""
	LastTestMessage string
	UpdatedAt       string
}

// NotificationRuleItem định nghĩa sự kiện cảnh báo hệ thống (threats, node health, ddos, cert expiry...).
type NotificationRuleItem struct {
	ID          string
	Name        string
	Description string
	Severity    string // "critical" | "high" | "medium" | "low"
	Enabled     bool
	UpdatedAt   string
}

// NotificationOverview là flat projection toàn cảnh trang Notifications Settings.
type NotificationOverview struct {
	Channels []NotificationChannelItem
	Rules    []NotificationRuleItem
}

// TestNotificationResult trả về kết quả kiểm tra gửi thông báo thử nghiệm tới kênh.
type TestNotificationResult struct {
	Success   bool
	Message   string
	LatencyMs int64
}

// AlertEvent là thông điệp cảnh báo sự cố hệ thống được đưa vào hàng đợi bất đồng bộ.
type AlertEvent struct {
	RuleID    string
	Title     string
	Message   string
	Severity  string // "critical" | "high" | "medium" | "low"
	Source    string
	Timestamp int64 // Unix timestamp (ms)
	Metadata  map[string]interface{}
}

