package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainservice "aurora-waf.local/control-plane/internal/domain/service"
)

type l4Service struct {
	repo       repo.L4Repository
	onMutation func()
}

// NewL4Service khởi tạo L4 domain service implementation.
func NewL4Service(r repo.L4Repository, onMutation ...func()) domainservice.L4Service {
	if r == nil {
		panic("l4Repo cannot be nil")
	}
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &l4Service{
		repo:       r,
		onMutation: fn,
	}
}

func (s *l4Service) notifyMutation() {
	if s.onMutation != nil {
		s.onMutation()
	}
}

func (s *l4Service) ListServices(ctx context.Context, q entity.ListL4ServicesQuery) ([]entity.L4ServiceItem, int, error) {
	if q.Limit <= 0 {
		q.Limit = 50
	}
	if q.Limit > 200 {
		q.Limit = 200
	}
	return s.repo.ListServices(ctx, q)
}

func (s *l4Service) GetServiceByID(ctx context.Context, id string) (*entity.L4ServiceItem, error) {
	return s.repo.GetServiceByID(ctx, id)
}

func (s *l4Service) GetServiceByPortProto(ctx context.Context, protocol string, port int) (*entity.L4ServiceItem, error) {
	return s.repo.GetServiceByPortProto(ctx, protocol, port)
}

func (s *l4Service) CreateService(ctx context.Context, c entity.CreateL4ServiceCommand) (*entity.L4ServiceItem, error) {
	if c.ID == "" {
		b := make([]byte, 6)
		rand.Read(b)
		c.ID = "l4s_" + hex.EncodeToString(b)
	}
	if c.ACLRulesJSON == "" {
		c.ACLRulesJSON = "[]"
	}
	if c.ProxyTimeout == "" {
		c.ProxyTimeout = "1h"
	}
	if c.ProxyConnectTimeout == "" {
		c.ProxyConnectTimeout = "5s"
	}

	item, err := s.repo.CreateService(ctx, c)
	if err != nil {
		return nil, err
	}

	s.notifyMutation()
	return item, nil
}

func (s *l4Service) UpdateService(ctx context.Context, c entity.UpdateL4ServiceCommand) (*entity.L4ServiceItem, error) {
	if c.ACLRulesJSON == "" {
		c.ACLRulesJSON = "[]"
	}
	if c.ProxyTimeout == "" {
		c.ProxyTimeout = "1h"
	}
	if c.ProxyConnectTimeout == "" {
		c.ProxyConnectTimeout = "5s"
	}

	item, err := s.repo.UpdateService(ctx, c)
	if err != nil {
		return nil, err
	}

	s.notifyMutation()
	return item, nil
}

func (s *l4Service) DeleteService(ctx context.Context, id string) error {
	if err := s.repo.DeleteService(ctx, id); err != nil {
		return err
	}

	s.notifyMutation()
	return nil
}
