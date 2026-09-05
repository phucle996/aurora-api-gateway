package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type CreateRuleDefinitionService interface {
	CreateDefinition(context.Context, entity.CreateRuleDefinitionCommand) (entity.CreateRuleDefinitionResult, error)
}
