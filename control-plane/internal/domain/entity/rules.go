package entity

import (
	"time"
)

// PublishRulesSource là dữ liệu trung gian giữa repository và service
// trong workflow publish. Repository Reserve() trả về struct này;
// service dùng nó để chạy compiler rồi gọi Complete().
type PublishRulesSource struct {
	ID            int64
	Payload       []byte
	State, Digest string
}

type RuleHistoryQuery struct {
	ID     int64
	Before int64
	Limit  int
}
type RuleHistoryRecord struct {
	Version   int64
	Name      string
	Action    string
	Enabled   bool
	Actor     string
	UpdatedAt string
}
type RuleHistoryResult struct {
	Items      []RuleHistoryRecord
	NextBefore int64
}

type CreateRuleCommand struct {
	RequestKey  string
	Name        string
	Description string
	Group       string
	Action      string
	Severity    string
	Score       int
	Priority    int
	Path        string
	Enabled     bool
}
type CreateRuleResult struct {
	ID      int64
	Version int64
}
type UpdateRuleCommand struct {
	ID              int64
	ExpectedVersion int64
	Name            string
	Description     string
	Group           string
	Action          string
	Severity        string
	Score           int
	Priority        int
	Path            string
	Enabled         bool
}
type UpdateRuleResult struct {
	ID      int64
	Version int64
}
type ListRulesQuery struct {
	Limit                                    int
	After                                    int64
	Search, Group, Action, Severity, Enabled string
}
type ListRulesItem struct {
	SchemaVersion int
	RuntimeReady  bool
	ID            int64
	Version       int64
	Name          string
	Description   string
	Group         string
	Action        string
	Severity      string
	Score         int
	Priority      int
	Path          string
	Enabled       bool
	UpdatedAt     string
}
type ListRulesResult struct {
	Total     int
	Items     []ListRulesItem
	NextAfter string
}
type RuleDetailQuery struct{ ID int64 }
type RuleDetailResult struct {
	SchemaVersion   int
	RuntimeReady    bool
	RuntimeIssues   []string
	LogicMode       string
	Conditions      []RuleDetailCondition
	SourceIP        string
	HostDomain      string
	PathPrefix      string
	HTTPMethod      string
	ResponseCode    *int
	CustomResponse  string
	LogEvent        bool
	AddToReputation bool
	ID              int64
	Version         int64
	Name            string
	Description     string
	Group           string
	Action          string
	Severity        string
	Score           int
	Priority        int
	Path            string
	Enabled         bool
	UpdatedAt       string
}
type RuleStatsQuery struct{ AsOf time.Time }
type RuleDetailCondition struct {
	Field      string
	Operator   string
	Value      string
	HeaderName string
}
type RuleStatsResult struct {
	AsOf             string
	ComparisonBefore string
	HistoryAvailable bool
	TotalDelta       *int
	EnabledDelta     *int
	LogDelta         *int
	BlockDelta       *int
	Total            int
	Enabled          int
	Log              int
	Block            int
}
type PublishRulesCommand struct{ RequestKey string }
type PublishRulesResult struct {
	ID     int64
	State  string
	Digest string
}
type ReleaseDetailQuery struct{ ID int64 }
type ReleaseDetailResult struct {
	ID              int64
	State           string
	Digest          string
	CreatedAt       string
	ActivationPhase *string
}

// ─── Rule Definition (v2) ───────────────────────────────────────────────────

type CreateRuleDefinitionCommand struct {
	RequestKey      string
	Name            string
	Description     string
	Group           string
	Severity        string
	Score           int
	Enabled         bool
	Priority        int
	PolicyID        *string
	LogicMode       string
	Conditions      []CreateRuleCondition
	Action          string
	ResponseCode    *int
	CustomResponse  string
	LogEvent        bool
	AddToReputation bool
	SourceIP        string
	HostDomain      string
	PathPrefix      string
	HTTPMethod      string
}

type CreateRuleCondition struct {
	Field      string
	Operator   string
	Value      string
	HeaderName string
}

type CreateRuleDefinitionResult struct {
	ID            int64
	Version       int64
	State         string
	RuntimeReady  bool
	RuntimeIssues []string
}

type CreateRuleFieldError struct {
	Fields map[string]string
}

func (e *CreateRuleFieldError) Error() string { return "invalid rule definition" }
