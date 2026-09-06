package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type DomainService struct {
	repo repo.DomainRepository
}

func NewDomainService(r repo.DomainRepository) port.DomainService {
	return &DomainService{
		repo: r,
	}
}

func (s *DomainService) ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error) {
	return s.repo.ListDomains(ctx, q)
}
