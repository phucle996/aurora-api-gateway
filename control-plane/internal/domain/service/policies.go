package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// PolicyService là interface duy nhất cho toàn bộ nghiệp vụ Policy.
type PolicyService interface {
	Save(context.Context, entity.SavePolicyCommand) (entity.SavePolicyResult, error)
	Publish(context.Context, entity.PublishPolicyCommand) (entity.PublishPolicyResult, error)
	ReadPolicies(context.Context, entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error)
	PolicyCatalog(context.Context) ([]entity.PolicyCatalogItem, error)
	PolicyRuleCatalog(context.Context) ([]entity.PolicyCatalogRule, error)
	PolicyCluster(context.Context) (entity.PolicyClusterStatus, error)
	PolicySync(context.Context, entity.PolicySyncQuery) (entity.PolicySyncResult, error)
	PolicyReport(context.Context, entity.PolicyReportCommand) error
}
