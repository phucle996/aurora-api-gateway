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
	Version   int64  `json:"version"`
	Name      string `json:"name"`
	Action    string `json:"action"`
	Enabled   bool   `json:"enabled"`
	Actor     string `json:"actor"`
	UpdatedAt string `json:"updated_at"`
}
type RuleHistoryResult struct {
	Items      []RuleHistoryRecord `json:"items"`
	NextBefore int64               `json:"next_before,omitempty"`
}

type CreateRuleCommand struct {
	RequestKey  string `json:"-"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Group       string `json:"group"`
	Action      string `json:"action"`
	Severity    string `json:"severity"`
	Score       int    `json:"score"`
	Priority    int    `json:"priority"`
	Path        string `json:"path"`
	Enabled     bool   `json:"enabled"`
}
type CreateRuleResult struct {
	ID      int64 `json:"id,string"`
	Version int64 `json:"version"`
}
type UpdateRuleCommand struct {
	ID              int64  `json:"-"`
	ExpectedVersion int64  `json:"expected_version"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Group           string `json:"group"`
	Action          string `json:"action"`
	Severity        string `json:"severity"`
	Score           int    `json:"score"`
	Priority        int    `json:"priority"`
	Path            string `json:"path"`
	Enabled         bool   `json:"enabled"`
}
type UpdateRuleResult struct {
	ID      int64 `json:"id,string"`
	Version int64 `json:"version"`
}
type ListRulesQuery struct {
	Limit                                    int
	After                                    int64
	Search, Group, Action, Severity, Enabled string
}
type ListRulesItem struct {
	SchemaVersion int    `json:"schema_version"`
	RuntimeReady  bool   `json:"runtime_ready"`
	ID            int64  `json:"id,string"`
	Version       int64  `json:"version"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Group         string `json:"group"`
	Action        string `json:"action"`
	Severity      string `json:"severity"`
	Score         int    `json:"score"`
	Priority      int    `json:"priority"`
	Path          string `json:"path"`
	Enabled       bool   `json:"enabled"`
	UpdatedAt     string `json:"updated_at"`
}
type ListRulesResult struct {
	Total     int             `json:"total"`
	Items     []ListRulesItem `json:"items"`
	NextAfter string          `json:"next_after,omitempty"`
}
type RuleDetailQuery struct{ ID int64 }
type RuleDetailResult struct {
	SchemaVersion   int                   `json:"schema_version"`
	RuntimeReady    bool                  `json:"runtime_ready"`
	RuntimeIssues   []string              `json:"runtime_issues"`
	LogicMode       string                `json:"logic_mode"`
	Conditions      []RuleDetailCondition `json:"conditions"`
	SourceIP        string                `json:"source_ip"`
	HostDomain      string                `json:"host_domain"`
	PathPrefix      string                `json:"path_prefix"`
	HTTPMethod      string                `json:"http_method"`
	ResponseCode    *int                  `json:"response_code"`
	CustomResponse  string                `json:"custom_response"`
	LogEvent        bool                  `json:"log_event"`
	AddToReputation bool                  `json:"add_to_reputation"`
	ID              int64                 `json:"id,string"`
	Version         int64                 `json:"version"`
	Name            string                `json:"name"`
	Description     string                `json:"description"`
	Group           string                `json:"group"`
	Action          string                `json:"action"`
	Severity        string                `json:"severity"`
	Score           int                   `json:"score"`
	Priority        int                   `json:"priority"`
	Path            string                `json:"path"`
	Enabled         bool                  `json:"enabled"`
	UpdatedAt       string                `json:"updated_at"`
}
type RuleStatsQuery struct{ AsOf time.Time }
type RuleDetailCondition struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	HeaderName string `json:"header_name"`
}
type RuleStatsResult struct {
	AsOf             string `json:"as_of"`
	ComparisonBefore string `json:"comparison_before"`
	HistoryAvailable bool   `json:"history_available"`
	TotalDelta       *int   `json:"total_delta"`
	EnabledDelta     *int   `json:"enabled_delta"`
	LogDelta         *int   `json:"log_delta"`
	BlockDelta       *int   `json:"block_delta"`
	Total            int    `json:"total"`
	Enabled          int    `json:"enabled"`
	Log              int    `json:"log"`
	Block            int    `json:"block"`
}
type PublishRulesCommand struct{ RequestKey string }
type PublishRulesResult struct {
	ID     int64  `json:"id,string"`
	State  string `json:"state"`
	Digest string `json:"digest"`
}
type ReleaseDetailQuery struct{ ID int64 }
type ReleaseDetailResult struct {
	ID              int64   `json:"id,string"`
	State           string  `json:"state"`
	Digest          string  `json:"digest"`
	CreatedAt       string  `json:"created_at"`
	ActivationPhase *string `json:"activation_phase"`
}

// ─── Rule Definition (v2) ───────────────────────────────────────────────────

type CreateRuleDefinitionCommand struct {
	RequestKey      string                `json:"-"`
	Name            string                `json:"name"`
	Description     string                `json:"description"`
	Group           string                `json:"group"`
	Severity        string                `json:"severity"`
	Score           int                   `json:"score"`
	Enabled         bool                  `json:"enabled"`
	Priority        int                   `json:"priority"`
	PolicyID        *string               `json:"policy_id"`
	LogicMode       string                `json:"logic_mode"`
	Conditions      []CreateRuleCondition `json:"conditions"`
	Action          string                `json:"action"`
	ResponseCode    *int                  `json:"response_code"`
	CustomResponse  string                `json:"custom_response"`
	LogEvent        bool                  `json:"log_event"`
	AddToReputation bool                  `json:"add_to_reputation"`
	SourceIP        string                `json:"source_ip"`
	HostDomain      string                `json:"host_domain"`
	PathPrefix      string                `json:"path_prefix"`
	HTTPMethod      string                `json:"http_method"`
}

type CreateRuleCondition struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	HeaderName string `json:"header_name"`
}

type CreateRuleDefinitionResult struct {
	ID            int64    `json:"id,string"`
	Version       int64    `json:"version"`
	State         string   `json:"state"`
	RuntimeReady  bool     `json:"runtime_ready"`
	RuntimeIssues []string `json:"runtime_issues"`
}

type CreateRuleFieldError struct {
	Fields map[string]string `json:"fields"`
}

func (e *CreateRuleFieldError) Error() string { return "invalid rule definition" }

