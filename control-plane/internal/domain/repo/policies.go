package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type PolicySaveRepository interface {
	SavePolicy(context.Context, entity.SavePolicyCommand) (entity.SavePolicyResult, error)
}
type PolicyReadRepository interface {
	ReadPolicies(context.Context, entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error)
	PolicyCatalog(context.Context) ([]entity.PolicyCatalogItem, error)
	PolicyRuleCatalog(context.Context) ([]entity.PolicyCatalogRule, error)
	PolicyCluster(context.Context) (entity.PolicyClusterStatus, error)
}

// Compiler callback runs within the publication transaction so membership and
// authority cannot change between validation and the durable head transition.
type PolicyPublishRepository interface {
	PublishPolicy(context.Context, entity.PublishPolicyCommand, func(context.Context, []byte) error) (entity.PublishPolicyResult, error)
}
type PolicySyncRepository interface {
	PolicySync(context.Context, entity.PolicySyncQuery) (entity.PolicySyncResult, error)
	PolicyReport(context.Context, entity.PolicyReportCommand) error
}
