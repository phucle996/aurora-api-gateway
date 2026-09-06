package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// PolicyRepository là interface duy nhất quản lý toàn bộ các thao tác dữ liệu của Policy workflow.
type PolicyRepository interface {
	// Write / Mutation
	SavePolicy(context.Context, entity.SavePolicyCommand) (entity.SavePolicyResult, error)

	// Read / Catalog / Status
	ReadPolicies(context.Context, entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error)
	PolicyCatalog(context.Context) ([]entity.PolicyCatalogItem, error)
	PolicyRuleCatalog(context.Context) ([]entity.PolicyCatalogRule, error)
	PolicyCluster(context.Context) (entity.PolicyClusterStatus, error)

	// Compiler callback runs within the publication transaction so membership and
	// authority cannot change between validation and the durable head transition.
	PublishPolicy(context.Context, entity.PublishPolicyCommand, func(context.Context, []byte) error) (entity.PublishPolicyResult, error)

	// Node Sync & Reporting
	PolicySync(context.Context, entity.PolicySyncQuery) (entity.PolicySyncResult, error)
	PolicyReport(context.Context, entity.PolicyReportCommand) error
}
