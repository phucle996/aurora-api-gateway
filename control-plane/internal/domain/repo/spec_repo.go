package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// SpecSyncRepository defines the data access contract for the unified spec synchronization workflow.
// Following the Flat workflow principle, it returns workflow-specific flat projections only.
type SpecSyncRepository interface {
	GetAuthorityData(ctx context.Context, nodeID string) (*entity.SpecAuthorityData, error)
	RecordReport(ctx context.Context, cmd entity.SpecReportCommand) error
}
