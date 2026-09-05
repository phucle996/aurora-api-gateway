package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// RuleRepository là interface duy nhất cho toàn bộ rule workflow.
// Một struct (ruleRepository) implement tất cả method bên dưới.
type RuleRepository interface {
	// --- Read ---
	List(context.Context, entity.ListRulesQuery) (entity.ListRulesResult, error)
	Detail(context.Context, entity.RuleDetailQuery) (entity.RuleDetailResult, error)
	Stats(context.Context, entity.RuleStatsQuery) (entity.RuleStatsResult, error)
	History(context.Context, entity.RuleHistoryQuery) (entity.RuleHistoryResult, error)
	Release(context.Context, entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error)

	// --- Write ---
	Create(context.Context, entity.CreateRuleCommand) (entity.CreateRuleResult, error)
	CreateDefinition(context.Context, entity.CreateRuleDefinitionCommand, []string, string) (entity.CreateRuleDefinitionResult, error)
	Update(context.Context, entity.UpdateRuleCommand) (entity.UpdateRuleResult, error)

	// --- Publish ---
	// Reserve snapshot toàn bộ rule đang enabled thành 1 release.
	// Complete đánh dấu release là "ready" sau khi compiler xác nhận.
	Reserve(context.Context, entity.PublishRulesCommand) (entity.PublishRulesSource, error)
	Complete(ctx context.Context, id int64, digest string) error
}
