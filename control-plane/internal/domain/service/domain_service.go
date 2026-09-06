package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DomainService là port nghiệp vụ quản lý các workflow liên quan tới Domain.
type DomainService interface {
	ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error)
}
