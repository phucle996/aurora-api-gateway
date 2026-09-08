package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type DomainRoutingService interface {
	DesiredRouting(context.Context, entity.DomainRoutingQuery) (entity.DomainRoutingResult, error)
}
