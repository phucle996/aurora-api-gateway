package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type SpecSyncService interface {
	SyncSpec(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error)
	ReportSpec(ctx context.Context, cmd entity.SpecReportCommand) error
}
