package repo

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
)

// AlertmanagerRepository định nghĩa cổng lưu trữ cấu hình tích hợp Alertmanager.
type AlertmanagerRepository interface {
	GetSettings(ctx context.Context) (*entity.AlertmanagerSettings, error)
	UpdateSettings(ctx context.Context, settings entity.AlertmanagerSettings) error
}
