package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type AccessRepository interface {
	Change(ctx context.Context, c entity.AccessChangeCommand, compile func(context.Context, []byte) error) (entity.AccessChangeResult, error)
	Read(ctx context.Context, q entity.AccessReadQuery) ([]entity.AccessReadItem, error)
	Status(ctx context.Context) (entity.AccessStatusResult, error)
	Desired(ctx context.Context, q entity.AccessSyncQuery) (entity.AccessSyncResult, error)
	Report(ctx context.Context, c entity.AccessReportCommand) error
	Match(ctx context.Context, c entity.AccessMatchCommand) error
	Activity(ctx context.Context) ([]entity.AccessActivityItem, error)
	Catalog(ctx context.Context) (entity.AccessCatalog, error)
}
