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

type DependenciesService = port.DependenciesService

var validModuleName = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,100}$`)

type dependenciesService struct {
	repo repo.DependenciesRepository
}

// NewDependenciesService khởi tạo service quản lý dependencies và jobs của cluster node.
func NewDependenciesService(r repo.DependenciesRepository) DependenciesService {
	return &dependenciesService{repo: r}
}

func (s *dependenciesService) List(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error) {
	out, e := s.repo.ListDependencies(ctx, q)
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

func (s *dependenciesService) Queue(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error) {
	if c.Actor == "" || c.NodeID == "" || (c.Action != "check" && c.Action != "install_brotli") {
		return entity.QueueDependencyResult{}, fmt.Errorf("unsupported dependency action")
	}
	return s.repo.QueueDependency(ctx, c)
}

func (s *dependenciesService) Poll(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error) {
	return s.repo.PollDependency(ctx, q)
}

func (s *dependenciesService) Report(ctx context.Context, c entity.ReportDependencyCommand) error {
	now := time.Now().UnixMilli()
	if c.CheckedAt < now-90000 || c.CheckedAt > now+30000 || len(c.NginxVersion) > 80 || len(c.Architecture) > 40 || len(c.Modules) > 128 || len(c.Error) > 300 || len(c.JobMessage) > 300 || c.JobID < 0 {
		return fmt.Errorf("invalid dependency report")
	}
	if c.JobID > 0 && c.JobState != "succeeded" && c.JobState != "failed" {
		return fmt.Errorf("invalid dependency result")
	}
	names := map[string]bool{}
	for _, m := range c.Modules {
		if !validModuleName.MatchString(m.Name) || names[m.Name] || len(m.Source) > 100 || (m.Loaded && !m.Available) {
			return fmt.Errorf("invalid module observation")
		}
		names[m.Name] = true
	}
	return s.repo.ReportDependency(ctx, c)
}
