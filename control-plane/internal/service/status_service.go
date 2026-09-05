package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainservice "aurora-waf.local/control-plane/internal/domain/service"
	"context"
)

type statusService struct{ storage repo.StorageRepository }

func NewStatusService(storage repo.StorageRepository) domainservice.StatusService {
	return &statusService{storage: storage}
}

func (s *statusService) Status() entity.ControllerStatus {
	return entity.ControllerStatus{
		Component: "aurora-controller", Stage: "foundation", EnforcementReady: nil,
		Message: "Embedded console available; controller does not observe NGINX node enforcement",
	}
}

func (s *statusService) Ready(ctx context.Context) error { return s.storage.Check(ctx) }
