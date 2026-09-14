package repo

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
)

// ExtensionRepository defines the data access contract for the extensions workflow.
type ExtensionRepository interface {
	List(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error)
	GetByID(ctx context.Context, id string) (*entity.ExtensionRecord, error)
	UpdateStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error
	UpdateConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error
}
