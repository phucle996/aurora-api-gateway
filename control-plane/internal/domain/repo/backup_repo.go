package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// BackupRepository định nghĩa port truy xuất và lưu trữ cấu hình backup cùng nhật ký lịch sử.
type BackupRepository interface {
	GetConfig(ctx context.Context) (*entity.BackupConfig, error)
	UpdateConfig(ctx context.Context, cfg entity.BackupConfig) error
	RecordHistory(ctx context.Context, item entity.BackupHistoryItem) error
	ListHistory(ctx context.Context, limit int) ([]entity.BackupHistoryItem, error)
	UpdateLastBackup(ctx context.Context, destination string, status string) error
}
