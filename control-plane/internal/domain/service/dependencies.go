package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// DependenciesService định nghĩa port nghiệp vụ quản lý dependencies và dispatch background jobs cho cluster nodes.
type DependenciesService interface {
	List(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error)
	Queue(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error)
	Poll(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error)
	Report(ctx context.Context, c entity.ReportDependencyCommand) error
}
