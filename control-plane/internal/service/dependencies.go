package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"fmt"
	"regexp"
	"time"
)

type ListDependenciesService struct {
	repo repo.ListDependenciesRepository
}

func NewListDependenciesService(r repo.ListDependenciesRepository) *ListDependenciesService {
	return &ListDependenciesService{r}
}
func (s *ListDependenciesService) List(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error) {
	out, e := s.repo.ListDependencies(ctx, q)
	if e != nil {
		return nil, e
	}
	for i := range out {
		out[i].Fresh = out[i].CheckedAt > time.Now().UnixMilli()-90000
		out[i].Installable = out[i].Installable && out[i].Fresh
	}
	return out, nil
}

type QueueDependencyService struct {
	repo repo.QueueDependencyRepository
}

func NewQueueDependencyService(r repo.QueueDependencyRepository) *QueueDependencyService {
	return &QueueDependencyService{r}
}
func (s *QueueDependencyService) Queue(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error) {
	if c.Actor == "" || c.NodeID == "" || (c.Action != "check" && c.Action != "install_brotli") {
		return entity.QueueDependencyResult{}, fmt.Errorf("unsupported dependency action")
	}
	return s.repo.QueueDependency(ctx, c)
}

type PollDependencyService struct{ repo repo.PollDependencyRepository }

func NewPollDependencyService(r repo.PollDependencyRepository) *PollDependencyService {
	return &PollDependencyService{r}
}
func (s *PollDependencyService) Poll(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error) {
	return s.repo.PollDependency(ctx, q)
}

type ReportDependencyService struct {
	repo repo.ReportDependencyRepository
}

func NewReportDependencyService(r repo.ReportDependencyRepository) *ReportDependencyService {
	return &ReportDependencyService{r}
}
func (s *ReportDependencyService) Report(ctx context.Context, c entity.ReportDependencyCommand) error {
	now := time.Now().UnixMilli()
	if c.CheckedAt < now-90000 || c.CheckedAt > now+30000 || len(c.NginxVersion) > 80 || len(c.Architecture) > 40 || len(c.Modules) > 128 || len(c.Error) > 300 || len(c.JobMessage) > 300 || c.JobID < 0 {
		return fmt.Errorf("invalid dependency report")
	}
	if c.JobID > 0 && c.JobState != "succeeded" && c.JobState != "failed" {
		return fmt.Errorf("invalid dependency result")
	}
	names := map[string]bool{}
	valid := regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,100}$`)
	for _, m := range c.Modules {
		if !valid.MatchString(m.Name) || names[m.Name] || len(m.Source) > 100 || m.Loaded && !m.Available {
			return fmt.Errorf("invalid module observation")
		}
		names[m.Name] = true
	}
	return s.repo.ReportDependency(ctx, c)
}
