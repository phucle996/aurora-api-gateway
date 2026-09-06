package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type PolicySaveService interface {
	Save(context.Context, entity.SavePolicyCommand) (entity.SavePolicyResult, error)
}
type PolicyPublishService interface {
	Publish(context.Context, entity.PublishPolicyCommand) (entity.PublishPolicyResult, error)
}
type PolicyReadService interface {
	ReadPolicies(context.Context, entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error)
	PolicyCatalog(context.Context) ([]entity.PolicyCatalogItem, error)
	PolicyRuleCatalog(context.Context) ([]entity.PolicyCatalogRule, error)
	PolicyCluster(context.Context) (entity.PolicyClusterStatus, error)
}
type PolicySyncService interface {
	PolicySync(context.Context, entity.PolicySyncQuery) (entity.PolicySyncResult, error)
	PolicyReport(context.Context, entity.PolicyReportCommand) error
}
