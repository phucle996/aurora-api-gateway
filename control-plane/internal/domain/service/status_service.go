package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type StatusService interface {
	Status() entity.ControllerStatus
	Ready(context.Context) error
}
