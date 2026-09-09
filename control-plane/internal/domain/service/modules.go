package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// ModuleStoreService định nghĩa port nghiệp vụ quản lý module store và dispatch background jobs cho cluster nodes.
type ModuleStoreService interface {
	List(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error)
	Queue(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error)
	Poll(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error)
	Report(ctx context.Context, c entity.ReportModuleCommand) error
	GetJobLogs(ctx context.Context, q entity.ModuleJobLogsQuery) (*entity.ModuleJobLogs, error)
}
