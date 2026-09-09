package service

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type ModuleStoreService = port.ModuleStoreService

var (
	validModuleName   = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,100}$`)
	validModuleAction = regexp.MustCompile(`^(check|(install|uninstall)_[a-zA-Z0-9_.-]{2,50})$`)
)

type moduleStoreService struct {
	repo repo.ModuleStoreRepository
}

// NewModuleStoreService khởi tạo service quản lý module store và background jobs của cluster node.
func NewModuleStoreService(r repo.ModuleStoreRepository) ModuleStoreService {
	return &moduleStoreService{repo: r}
}

func (s *moduleStoreService) List(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error) {
	out, e := s.repo.ListModules(ctx, q)
	if e != nil {
		return nil, e
	}
	now := time.Now().UnixMilli()
	for i := range out {
		out[i].Fresh = out[i].CheckedAt > now-90000
		out[i].Installable = out[i].Installable && out[i].Fresh
	}
	return out, nil
}

func (s *moduleStoreService) Queue(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error) {
	if c.Actor == "" || c.NodeID == "" || !validModuleAction.MatchString(c.Action) {
		return entity.QueueModuleJobResult{}, fmt.Errorf("unsupported module action")
	}
	return s.repo.QueueJob(ctx, c)
}

func (s *moduleStoreService) Poll(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	return s.repo.PollJob(ctx, q)
}

func (s *moduleStoreService) Report(ctx context.Context, c entity.ReportModuleCommand) error {
	now := time.Now().UnixMilli()
	if c.CheckedAt < now-90000 || c.CheckedAt > now+30000 || len(c.NginxVersion) > 80 || len(c.Architecture) > 40 || len(c.Modules) > 128 || len(c.Error) > 300 || len(c.JobMessage) > 300 || len(c.JobLogs) > 65536 || c.JobID < 0 {
		return fmt.Errorf("invalid module report")
	}
	if c.JobID > 0 && c.JobState != "succeeded" && c.JobState != "failed" {
		return fmt.Errorf("invalid module result")
	}
	names := map[string]bool{}
	for _, m := range c.Modules {
		if !validModuleName.MatchString(m.Name) || names[m.Name] || len(m.Source) > 100 || (m.Loaded && !m.Available) {
			return fmt.Errorf("invalid module observation")
		}
		names[m.Name] = true
	}
	return s.repo.ReportModules(ctx, c)
}

func (s *moduleStoreService) GetJobLogs(ctx context.Context, q entity.ModuleJobLogsQuery) (*entity.ModuleJobLogs, error) {
	if q.JobID <= 0 {
		return nil, fmt.Errorf("invalid job ID")
	}
	return s.repo.GetJobLogs(ctx, q.JobID)
}
