package dto

// UpdateNotificationChannelRequest mang dữ liệu cập nhật trạng thái và cấu hình kênh thông báo.
type UpdateNotificationChannelRequest struct {
	Enabled    bool   `json:"enabled"`
	ConfigJSON string `json:"config_json"`
}

// UpdateNotificationRuleRequest mang dữ liệu bật/tắt quy tắc cảnh báo.
type UpdateNotificationRuleRequest struct {
	Enabled bool `json:"enabled"`
}
