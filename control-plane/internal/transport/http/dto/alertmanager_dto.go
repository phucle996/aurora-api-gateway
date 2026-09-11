package dto

import "aurora-waf.local/control-plane/internal/domain/entity"

// UpdateAlertmanagerConfigRequest chứa thông tin cấu hình cập nhật tích hợp Alertmanager & Prometheus.
type UpdateAlertmanagerConfigRequest struct {
	Enabled         *bool  `json:"enabled" binding:"required"`
	AlertmanagerURL string `json:"alertmanager_url" binding:"required"`
	PrometheusURL   string `json:"prometheus_url" binding:"required"`
}

// CreateSilenceRequest nhận payload tạo khoảng lặng tạm thời trên Alertmanager.
type CreateSilenceRequest struct {
	StartsAt  string                       `json:"starts_at"`
	EndsAt    string                       `json:"ends_at" binding:"required"`
	CreatedBy string                       `json:"created_by"`
	Comment   string                       `json:"comment" binding:"required"`
	Matchers  []entity.AlertmanagerMatcher `json:"matchers" binding:"required"`
}
