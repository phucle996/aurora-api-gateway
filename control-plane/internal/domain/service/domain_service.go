package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DomainService là port nghiệp vụ quản lý các workflow liên quan tới Domain.
type DomainService interface {
	ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error)
	DomainCatalog(ctx context.Context) ([]entity.DomainCatalogItem, error)
	CreateDomain(ctx context.Context, cmd entity.CreateDomainCommand) (*entity.ListDomainsItem, error)
	GetDomain(ctx context.Context, id int64) (*entity.ListDomainsItem, error)
	UpdateDomain(ctx context.Context, id int64, cmd entity.UpdateDomainCommand) (*entity.ListDomainsItem, error)
	DeleteDomain(ctx context.Context, id int64) error
}
