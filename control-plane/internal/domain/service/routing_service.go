package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// RoutingService định nghĩa hợp đồng nghiệp vụ cho Routing workflow.
type RoutingService interface {
	ListRoutes(ctx context.Context, q entity.ListRoutesQuery) (entity.ListRoutesResult, error)
	GetRouteByID(ctx context.Context, id string) (*entity.RouteItem, error)
	CreateRoute(ctx context.Context, cmd entity.CreateRouteCommand) (*entity.RouteItem, error)
	UpdateRoute(ctx context.Context, cmd entity.UpdateRouteCommand) (*entity.RouteItem, error)
	DeleteRoute(ctx context.Context, id string) error
	ToggleRouteStatus(ctx context.Context, id string, enabled bool) error
}
