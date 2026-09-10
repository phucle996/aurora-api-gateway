package service

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

type policyService struct {
	repo       repo.PolicyRepository
	compiler   string
	onMutation func()
}

// NewPolicyService khởi tạo service duy nhất quản lý toàn bộ nghiệp vụ Policy.
func NewPolicyService(repo repo.PolicyRepository, compiler string, onMutation ...func()) domainService.PolicyService {
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &policyService{
		repo:       repo,
		compiler:   compiler,
		onMutation: fn,
	}
}

func (s *policyService) ReadPolicies(ctx context.Context, q entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error) {
	return s.repo.ReadPolicies(ctx, q)
}

func (s *policyService) PolicyCatalog(ctx context.Context) ([]entity.PolicyCatalogItem, error) {
	return s.repo.PolicyCatalog(ctx)
}

func (s *policyService) PolicyRuleCatalog(ctx context.Context) ([]entity.PolicyCatalogRule, error) {
	return s.repo.PolicyRuleCatalog(ctx)
}

func (s *policyService) PolicyCluster(ctx context.Context) (entity.PolicyClusterStatus, error) {
	return s.repo.PolicyCluster(ctx)
}

func (s *policyService) PolicySync(ctx context.Context, q entity.PolicySyncQuery) (entity.PolicySyncResult, error) {
	return s.repo.PolicySync(ctx, q)
}

func (s *policyService) PolicyReport(ctx context.Context, c entity.PolicyReportCommand) error {
	return s.repo.PolicyReport(ctx, c)
}

func (s *policyService) Save(ctx context.Context, c entity.SavePolicyCommand) (entity.SavePolicyResult, error) {
	return s.repo.SavePolicy(ctx, c)
}

func (s *policyService) Publish(ctx context.Context, c entity.PublishPolicyCommand) (entity.PublishPolicyResult, error) {
	if s.compiler == "" {
		return entity.PublishPolicyResult{}, taxonomy.ErrPublishUnavailable
	}
	res, err := s.repo.PublishPolicy(ctx, c, func(ctx context.Context, payload []byte) error {
		if len(payload) > 65536 {
			return fmt.Errorf("%w: cluster exceeds 64 KiB runtime snapshot", taxonomy.ErrPolicyInvalid)
		}
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, s.compiler)
		cmd.Stdin = bytes.NewReader(payload)
		out := &policyCompilerOutput{}
		cmd.Stdout = out
		if err := cmd.Run(); err != nil || !bytes.Equal(out.buffer.Bytes(), payload) {
			return taxonomy.ErrPublishUnavailable
		}
		return nil
	})
	if err == nil && s.onMutation != nil {
		s.onMutation()
	}
	return res, err
}

// Publication-local output limit is required at the untrusted subprocess boundary.
type policyCompilerOutput struct{ buffer bytes.Buffer }

func (b *policyCompilerOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 65536 {
		return 0, taxonomy.ErrPublishUnavailable
	}
	return b.buffer.Write(p)
}
