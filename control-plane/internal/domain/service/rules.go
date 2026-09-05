package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// RuleService là interface duy nhất cho toàn bộ nghiệp vụ liên quan đến Rule và Release.
// Mỗi hàm đại diện cho một hành vi cụ thể của đối tượng Rule.
type RuleService interface {
	// --- Nhóm truy vấn (Query) ---
	List(context.Context, entity.ListRulesQuery) (entity.ListRulesResult, error)
	Detail(context.Context, entity.RuleDetailQuery) (entity.RuleDetailResult, error)
	Stats(context.Context, entity.RuleStatsQuery) (entity.RuleStatsResult, error)
	History(context.Context, entity.RuleHistoryQuery) (entity.RuleHistoryResult, error)
	Release(context.Context, entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error)

	// --- Nhóm thao tác thay đổi (Mutation & Publish) ---
	Create(context.Context, entity.CreateRuleCommand) (entity.CreateRuleResult, error)
	Update(context.Context, entity.UpdateRuleCommand) (entity.UpdateRuleResult, error)
	Publish(context.Context, entity.PublishRulesCommand) (entity.PublishRulesResult, error)
}
