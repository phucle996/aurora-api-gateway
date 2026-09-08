package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type ListDependenciesService interface {
	List(context.Context, entity.ListDependenciesQuery) ([]entity.DependencyNode, error)
}
type QueueDependencyService interface {
	Queue(context.Context, entity.QueueDependencyCommand) (entity.QueueDependencyResult, error)
}
type PollDependencyService interface {
	Poll(context.Context, entity.PollDependencyQuery) (entity.PollDependencyResult, error)
}
type ReportDependencyService interface {
	Report(context.Context, entity.ReportDependencyCommand) error
}
