package service

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
)

var (
	validModuleName   = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,100}$`)
	validModuleAction = regexp.MustCompile(`^(check|(install|uninstall)_[a-zA-Z0-9_.-]{2,50})$`)
)

type moduleStoreService struct {
	repo     repo.ModuleStoreRepository
	eventHub provider.EventHub
}

// NewModuleStoreService khởi tạo service quản lý module store và background jobs của cluster node.
func NewModuleStoreService(r repo.ModuleStoreRepository, eventHub provider.EventHub) port.ModuleStoreService {
	return &moduleStoreService{
		repo:     r,
		eventHub: eventHub,
	}
}

func (s *moduleStoreService) SubscribeJobEvents() (<-chan entity.SSEMessage, func()) {
	if s.eventHub == nil {
		return nil, func() {}
	}
	return s.eventHub.Subscribe()
}

func (s *moduleStoreService) broadcast(ev entity.ModuleJobProgressEvent) {
	if s.eventHub != nil {
		s.eventHub.Broadcast("module_job_progress", ev)
	}
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
	res, err := s.repo.QueueJob(ctx, c)
	if err == nil {
		s.broadcast(entity.ModuleJobProgressEvent{
			JobID:    res.ID,
			NodeID:   c.NodeID,
			Stage:    "QUEUED",
			Progress: 5,
			Message:  "Tác vụ đã được xếp vào hàng đợi chờ Node nhận lệnh",
			State:    res.State,
		})
	}
	return res, err
}

func (s *moduleStoreService) Poll(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	res, err := s.repo.PollJob(ctx, q)
	if err == nil && res.ID > 0 {
		s.broadcast(entity.ModuleJobProgressEvent{
			JobID:    res.ID,
			NodeID:   q.NodeID,
			Stage:    "RUNNING",
			Progress: 10,
			Message:  "Node đã nhận tác vụ và bắt đầu chuẩn bị thực thi",
			State:    "running",
		})
	}
	return res, err
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
	err := s.repo.ReportModules(ctx, c)
	if err == nil && c.JobID > 0 {
		progress := 100
		if c.JobState == "failed" {
			progress = 0
		}
		s.broadcast(entity.ModuleJobProgressEvent{
			JobID:    c.JobID,
			NodeID:   c.NodeID,
			Stage:    c.JobState,
			Progress: progress,
			Message:  c.JobMessage,
			LogChunk: c.JobLogs,
			State:    c.JobState,
		})
	}
	return err
}

func (s *moduleStoreService) GetJobLogs(ctx context.Context, q entity.ModuleJobLogsQuery) (*entity.ModuleJobLogs, error) {
	if q.JobID <= 0 {
		return nil, fmt.Errorf("invalid job ID")
	}
	return s.repo.GetJobLogs(ctx, q.JobID)
}

func (s *moduleStoreService) AppendJobLog(ctx context.Context, c entity.AppendModuleJobLogCommand) error {
	if c.JobID <= 0 || c.NodeID == "" {
		return fmt.Errorf("invalid job or node id")
	}
	if len(c.LogChunk) > 65536 {
		c.LogChunk = c.LogChunk[:65536]
	}
	if err := s.repo.AppendJobLog(ctx, c); err != nil {
		return err
	}
	s.broadcast(entity.ModuleJobProgressEvent{
		JobID:    c.JobID,
		NodeID:   c.NodeID,
		Stage:    c.Stage,
		Progress: c.Progress,
		Message:  c.Message,
		LogChunk: c.LogChunk,
		State:    "running",
	})
	return nil
}

func (s *moduleStoreService) GetSyncOverview(ctx context.Context, q entity.GetModuleSyncOverviewQuery) ([]entity.ModuleSyncItem, error) {
	return s.repo.GetSyncOverview(ctx, q)
}

func (s *moduleStoreService) SetDesiredState(ctx context.Context, c entity.SetModuleDesiredCommand) error {
	if !validModuleName.MatchString(c.Name) || c.Actor == "" {
		return fmt.Errorf("invalid module name or actor")
	}
	if err := s.repo.SetDesiredState(ctx, c); err != nil {
		return err
	}
	// Tự động kích hoạt fanout sync để đưa các node bị drift về desired state
	_, _ = s.repo.FanoutSync(ctx, entity.TriggerModuleSyncCommand{
		Name:  c.Name,
		Actor: c.Actor,
	})
	if s.eventHub != nil {
		s.eventHub.Broadcast("module_sync_changed", map[string]any{
			"module":  c.Name,
			"enabled": c.Enabled,
		})
	}
	return nil
}

func (s *moduleStoreService) Sync(ctx context.Context, c entity.TriggerModuleSyncCommand) (entity.TriggerModuleSyncResult, error) {
	if c.Actor == "" {
		return entity.TriggerModuleSyncResult{}, fmt.Errorf("actor required")
	}
	res, err := s.repo.FanoutSync(ctx, c)
	if err == nil && s.eventHub != nil {
		s.eventHub.Broadcast("module_sync_triggered", map[string]any{
			"queued_jobs": res.QueuedJobs,
			"node_ids":    res.NodeIDs,
		})
	}
	return res, err
}
