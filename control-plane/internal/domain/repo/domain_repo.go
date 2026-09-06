package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DomainRepository quản lý các thao tác dữ liệu độc lập của Domain workflow.
type DomainRepository interface {
	ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error)
}
