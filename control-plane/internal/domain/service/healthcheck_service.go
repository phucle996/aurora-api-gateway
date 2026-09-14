package service

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
)

type HealthcheckService interface {
	Status() entity.ControllerStatus
	Ready(context.Context) error
}
