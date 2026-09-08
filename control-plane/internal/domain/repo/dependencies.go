package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type ListDependenciesRepository interface {
	ListDependencies(context.Context, entity.ListDependenciesQuery) ([]entity.DependencyNode, error)
}
type QueueDependencyRepository interface {
	QueueDependency(context.Context, entity.QueueDependencyCommand) (entity.QueueDependencyResult, error)
}
type PollDependencyRepository interface {
	PollDependency(context.Context, entity.PollDependencyQuery) (entity.PollDependencyResult, error)
}
type ReportDependencyRepository interface {
	ReportDependency(context.Context, entity.ReportDependencyCommand) error
}
