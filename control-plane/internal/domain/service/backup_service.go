package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// BackupService định nghĩa port nghiệp vụ xử lý xuất snapshot, đẩy S3, lập lịch cron và restore.
type BackupService interface {
	GetOverview(ctx context.Context) (*entity.BackupOverview, error)
	UpdateConfig(ctx context.Context, cfg entity.BackupConfig) error
	CreateLocalSnapshot(ctx context.Context) ([]byte, string, error)
	TriggerS3Backup(ctx context.Context) (*entity.BackupHistoryItem, error)
	RestoreSnapshot(ctx context.Context, fileBytes []byte) (*entity.RestoreResult, error)
}
