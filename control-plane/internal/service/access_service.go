package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os/exec"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	domainrepo "aurora-waf.local/control-plane/internal/domain/repo"
	domainsvc "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

type accessService struct {
	repo         domainrepo.AccessRepository
	compilerPath string
	onMutation   func()
}

// NewAccessService creates a new access service instance with optional mutation callback.
func NewAccessService(repo domainrepo.AccessRepository, compilerPath string, onMutation ...func()) domainsvc.AccessService {
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &accessService{
		repo:         repo,
		compilerPath: compilerPath,
		onMutation:   fn,
	}
}

func (s *accessService) Change(ctx context.Context, c entity.AccessChangeCommand) (entity.AccessChangeResult, error) {
	res, err := s.repo.Change(ctx, c, func(ctx context.Context, payload []byte) error {
		if s.compilerPath == "" || len(payload) > 65536 {
			return taxonomy.ErrAccessCompiler
		}
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, s.compilerPath, "--access")
		cmd.Stdin = bytes.NewReader(payload)
		stdout, e := cmd.StdoutPipe()
		if e != nil {
			return taxonomy.ErrAccessCompiler
		}
		if e = cmd.Start(); e != nil {
			return taxonomy.ErrAccessCompiler
		}
		out, e := io.ReadAll(http.MaxBytesReader(nil, stdout, 65536))
		if e != nil || cmd.Wait() != nil || !bytes.Equal(out, payload) {
			return taxonomy.ErrAccessCompiler
		}
		return nil
	})
	if err == nil && s.onMutation != nil {
		s.onMutation()
	}
	return res, err
}

func (s *accessService) Read(ctx context.Context, q entity.AccessReadQuery) ([]entity.AccessReadItem, error) {
	return s.repo.Read(ctx, q)
}

func (s *accessService) Status(ctx context.Context) (entity.AccessStatusResult, error) {
	return s.repo.Status(ctx)
}

func (s *accessService) Desired(ctx context.Context, q entity.AccessSyncQuery) (entity.AccessSyncResult, error) {
	return s.repo.Desired(ctx, q)
}

func (s *accessService) Report(ctx context.Context, c entity.AccessReportCommand) error {
	return s.repo.Report(ctx, c)
}

func (s *accessService) Match(ctx context.Context, c entity.AccessMatchCommand) error {
	return s.repo.Match(ctx, c)
}

func (s *accessService) Activity(ctx context.Context) ([]entity.AccessActivityItem, error) {
	return s.repo.Activity(ctx)
}

func (s *accessService) Catalog(ctx context.Context) (entity.AccessCatalog, error) {
	return s.repo.Catalog(ctx)
}
