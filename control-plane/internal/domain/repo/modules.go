package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// ModuleStoreRepository định nghĩa port truy xuất và lưu trữ modules và background jobs của cluster node.
type ModuleStoreRepository interface {
	ListModules(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error)
	QueueJob(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error)
	PollJob(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error)
	ReportModules(ctx context.Context, c entity.ReportModuleCommand) error
	GetJobLogs(ctx context.Context, jobID int64) (*entity.ModuleJobLogs, error)
}
