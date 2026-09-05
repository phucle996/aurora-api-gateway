package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type PolicySaveService struct{ Repository repo.PolicySaveRepository }

type PolicyReadService struct{ Repository repo.PolicyReadRepository }

func (s PolicyReadService) ReadPolicies(ctx context.Context, q entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error) {
	return s.Repository.ReadPolicies(ctx, q)
}
func (s PolicyReadService) PolicyCatalog(ctx context.Context) ([]entity.PolicyCatalogRule, error) {
	return s.Repository.PolicyCatalog(ctx)
}
func (s PolicyReadService) PolicyCluster(ctx context.Context) (entity.PolicyClusterStatus, error) {
	return s.Repository.PolicyCluster(ctx)
}

type PolicySyncService struct{ Repository repo.PolicySyncRepository }

func (s PolicySyncService) PolicySync(ctx context.Context, q entity.PolicySyncQuery) (entity.PolicySyncResult, error) {
	return s.Repository.PolicySync(ctx, q)
}
func (s PolicySyncService) PolicyReport(ctx context.Context, c entity.PolicyReportCommand) error {
	if c.NodeID == "" || c.ReleaseID < 1 || len(c.Message) > 512 || (c.Phase != "validated" && c.Phase != "reload_requested" && c.Phase != "observed" && c.Phase != "failed") {
		return taxonomy.ErrPolicyInvalid
	}
	return s.Repository.PolicyReport(ctx, c)
}

func (s PolicySaveService) Save(ctx context.Context, c entity.SavePolicyCommand) (entity.SavePolicyResult, error) {
	invalid := entity.SavePolicyResult{}
	if c.ID < 0 || c.ExpectedVersion < 0 || c.RestoreVersion < 0 || (c.ID == 0 && (c.ExpectedVersion != 0 || c.RestoreVersion != 0)) || (c.ID > 0 && c.ExpectedVersion == 0) || len(c.RequestKey) < 8 || len(c.RequestKey) > 128 || c.Actor == "" {
		return invalid, taxonomy.ErrPolicyInvalid
	}
	if c.RestoreVersion == 0 {
		c.Name = strings.TrimSpace(c.Name)
		c.Host = strings.ToLower(strings.TrimSpace(c.Host))
		c.PathPrefix = strings.TrimSpace(c.PathPrefix)
		if c.Name == "" || len(c.Name) > 120 || len(c.Description) > 2000 || !utf8.ValidString(c.Name+c.Description) || c.Priority < 0 || c.Priority > 1000000 || len(c.RuleIDs) > 1024 || (c.Mode != "mixed" && c.Mode != "block" && c.Mode != "detect") {
			return invalid, taxonomy.ErrPolicyInvalid
		}
		if c.Host == "" || len(c.Host) > 253 {
			return invalid, taxonomy.ErrPolicyInvalid
		}
		if c.Host != "*" {
			for _, label := range strings.Split(c.Host, ".") {
				if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
					return invalid, taxonomy.ErrPolicyInvalid
				}
				for _, b := range []byte(label) {
					if !(b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-') {
						return invalid, taxonomy.ErrPolicyInvalid
					}
				}
			}
		}
		if !strings.HasPrefix(c.PathPrefix, "/") || len(c.PathPrefix) > 8192 || strings.ContainsAny(c.PathPrefix, "%?#\\*") || strings.Contains(c.PathPrefix, "//") {
			return invalid, taxonomy.ErrPolicyInvalid
		}
		for _, b := range []byte(c.PathPrefix) {
			if b <= 32 || b >= 127 {
				return invalid, taxonomy.ErrPolicyInvalid
			}
		}
		for _, p := range strings.Split(c.PathPrefix, "/") {
			if p == "." || p == ".." {
				return invalid, taxonomy.ErrPolicyInvalid
			}
		}
		sort.Slice(c.RuleIDs, func(i, j int) bool { return c.RuleIDs[i] < c.RuleIDs[j] })
		for i, id := range c.RuleIDs {
			if id < 1 || (i > 0 && id == c.RuleIDs[i-1]) {
				return invalid, taxonomy.ErrPolicyInvalid
			}
		}
		if c.RuleIDs == nil {
			c.RuleIDs = []int64{}
		}
	}
	return s.Repository.SavePolicy(ctx, c)
}

type PolicyPublishService struct {
	Repository repo.PolicyPublishRepository
	Compiler   string
}

func (s PolicyPublishService) Publish(ctx context.Context, c entity.PublishPolicyCommand) (entity.PublishPolicyResult, error) {
	if c.ID < 1 || c.ExpectedVersion < 1 || c.ExpectedRelease < 0 || c.Actor == "" || (!c.Preview && (len(c.RequestKey) < 8 || len(c.RequestKey) > 128)) {
		return entity.PublishPolicyResult{}, taxonomy.ErrPolicyInvalid
	}
	if s.Compiler == "" {
		return entity.PublishPolicyResult{}, taxonomy.ErrPublishUnavailable
	}
	return s.Repository.PublishPolicy(ctx, c, func(ctx context.Context, payload []byte) error {
		if len(payload) > 65536 {
			return fmt.Errorf("%w: cluster exceeds 64 KiB runtime snapshot", taxonomy.ErrPolicyInvalid)
		}
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, s.Compiler)
		cmd.Stdin = bytes.NewReader(payload)
		out := &policyCompilerOutput{}
		cmd.Stdout = out
		if err := cmd.Run(); err != nil || !bytes.Equal(out.buffer.Bytes(), payload) {
			return taxonomy.ErrPublishUnavailable
		}
		return nil
	})
}

// Publication-local output limit is required at the untrusted subprocess boundary.
type policyCompilerOutput struct{ buffer bytes.Buffer }

func (b *policyCompilerOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 65536 {
		return 0, taxonomy.ErrPublishUnavailable
	}
	return b.buffer.Write(p)
}
