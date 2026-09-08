package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DomainRepository quản lý các thao tác dữ liệu độc lập của Domain workflow.
type DomainRepository interface {
	ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error)
	DomainCatalog(ctx context.Context) ([]entity.DomainCatalogItem, error)
	Create(ctx context.Context, cmd entity.CreateDomainCommand) (int64, error)
	GetByID(ctx context.Context, id int64) (*entity.ListDomainsItem, error)
	Update(ctx context.Context, id int64, cmd entity.UpdateDomainCommand) error
	Delete(ctx context.Context, id int64) error
}
