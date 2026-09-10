package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
)

type RoutingServiceImpl struct {
	routeRepo  repo.RouteRepository
	onMutation func()
}

func NewRoutingService(
	r repo.RouteRepository,
	onMutation ...func(),
) domainService.RoutingService {
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &RoutingServiceImpl{
		routeRepo:  r,
		onMutation: fn,
	}
}

func (s *RoutingServiceImpl) notifyMutation() {
	if s.onMutation != nil {
		s.onMutation()
	}
}

func (s *RoutingServiceImpl) ListRoutes(ctx context.Context, q entity.ListRoutesQuery) (entity.ListRoutesResult, error) {
	return s.routeRepo.ListRoutes(ctx, q)
}

func (s *RoutingServiceImpl) GetRouteByID(ctx context.Context, id string) (*entity.RouteItem, error) {
	return s.routeRepo.GetRouteByID(ctx, id)
}

func (s *RoutingServiceImpl) CreateRoute(ctx context.Context, cmd entity.CreateRouteCommand) (*entity.RouteItem, error) {
	if cmd.ID == "" {
		b := make([]byte, 6)
		rand.Read(b)
		cmd.ID = "rt_" + hex.EncodeToString(b)
	}

	if err := s.routeRepo.CreateRoute(ctx, cmd); err != nil {
		return nil, err
	}

	s.notifyMutation()
	return s.routeRepo.GetRouteByID(ctx, cmd.ID)
}

func (s *RoutingServiceImpl) UpdateRoute(ctx context.Context, cmd entity.UpdateRouteCommand) (*entity.RouteItem, error) {
	if err := s.routeRepo.UpdateRoute(ctx, cmd); err != nil {
		return nil, err
	}

	s.notifyMutation()
	return s.routeRepo.GetRouteByID(ctx, cmd.ID)
}

func (s *RoutingServiceImpl) DeleteRoute(ctx context.Context, id string) error {
	if err := s.routeRepo.DeleteRoute(ctx, id); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}

func (s *RoutingServiceImpl) ToggleRouteStatus(ctx context.Context, id string, enabled bool) error {
	if err := s.routeRepo.ToggleRouteStatus(ctx, id, enabled); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}
