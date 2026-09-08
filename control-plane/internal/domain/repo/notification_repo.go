package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// NotificationRepository định nghĩa port lưu trữ và truy xuất cấu hình kênh thông báo trong SQLite.
type NotificationRepository interface {
	GetOverview(ctx context.Context) (*entity.NotificationOverview, error)
	GetChannelByID(ctx context.Context, id string) (*entity.NotificationChannelItem, error)
	UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error
	UpdateRule(ctx context.Context, id string, enabled bool) error
	RecordTestResult(ctx context.Context, id string, status string, message string) error
	GetActiveChannelsCount(ctx context.Context) (int, error)
}
