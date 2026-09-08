package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// NotificationService định nghĩa port nghiệp vụ xử lý cấu hình thông báo và kiểm thử kênh.
type NotificationService interface {
	GetOverview(ctx context.Context) (*entity.NotificationOverview, error)
	UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error
	UpdateRule(ctx context.Context, id string, enabled bool) error
	TestChannel(ctx context.Context, id string) (*entity.TestNotificationResult, error)
	DispatchAlert(event entity.AlertEvent) bool
}

