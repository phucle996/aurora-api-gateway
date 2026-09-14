package service

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
)

type SpecSyncService interface {
	SyncSpec(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error)
	ReportSpec(ctx context.Context, cmd entity.SpecReportCommand) error
}
