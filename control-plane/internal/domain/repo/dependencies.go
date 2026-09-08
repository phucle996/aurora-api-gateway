package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DependenciesRepository định nghĩa port truy xuất và lưu trữ dependencies và jobs của cluster node.
type DependenciesRepository interface {
	ListDependencies(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error)
	QueueDependency(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error)
	PollDependency(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error)
	ReportDependency(ctx context.Context, c entity.ReportDependencyCommand) error
}
