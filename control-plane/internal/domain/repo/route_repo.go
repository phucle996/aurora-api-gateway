package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// RouteRepository quản lý các thao tác dữ liệu độc lập của Route workflow.
type RouteRepository interface {
	ListRoutes(ctx context.Context, q entity.ListRoutesQuery) (entity.ListRoutesResult, error)
	GetRouteByID(ctx context.Context, id string) (*entity.RouteItem, error)
	CreateRoute(ctx context.Context, cmd entity.CreateRouteCommand) error
	UpdateRoute(ctx context.Context, cmd entity.UpdateRouteCommand) error
	DeleteRoute(ctx context.Context, id string) error
	ToggleRouteStatus(ctx context.Context, id string, enabled bool) error
	GetAllActiveRoutes(ctx context.Context) ([]entity.RouteItem, error)
}
