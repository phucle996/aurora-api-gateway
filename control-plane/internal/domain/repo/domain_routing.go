package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type DomainRoutingRepository interface {
	RoutingRecords(context.Context, entity.DomainRoutingQuery) ([]entity.DomainRoutingRecord, error)
}
