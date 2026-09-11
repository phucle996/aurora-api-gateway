package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// AlertmanagerRepository định nghĩa cổng lưu trữ cấu hình tích hợp Alertmanager.
type AlertmanagerRepository interface {
	GetSettings(ctx context.Context) (*entity.AlertmanagerSettings, error)
	UpdateSettings(ctx context.Context, settings entity.AlertmanagerSettings) error
}
