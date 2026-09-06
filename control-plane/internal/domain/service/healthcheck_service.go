package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type HealthcheckService interface {
	Status() entity.ControllerStatus
	Ready(context.Context) error
}
