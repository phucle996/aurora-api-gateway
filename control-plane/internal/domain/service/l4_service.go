package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// L4Service định nghĩa các nghiệp vụ kiểm soát và điều phối L4 Gateway Services.
type L4Service interface {
	ListServices(ctx context.Context, q entity.ListL4ServicesQuery) ([]entity.L4ServiceItem, int, error)
	GetServiceByID(ctx context.Context, id string) (*entity.L4ServiceItem, error)
	GetServiceByPortProto(ctx context.Context, protocol string, port int) (*entity.L4ServiceItem, error)
	CreateService(ctx context.Context, c entity.CreateL4ServiceCommand) (*entity.L4ServiceItem, error)
	UpdateService(ctx context.Context, c entity.UpdateL4ServiceCommand) (*entity.L4ServiceItem, error)
	DeleteService(ctx context.Context, id string) error
}
