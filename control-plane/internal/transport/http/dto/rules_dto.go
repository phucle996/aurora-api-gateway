package dto

type CreateRuleRequest struct {
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

type UpdateRuleRequest struct {
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

type CreateRuleDefinitionRequest struct {
	Name            string                       `json:"name"`
	Description     string                       `json:"description"`
	Group           string                       `json:"group"`
	Severity        string                       `json:"severity"`
	Score           int                          `json:"score"`
	Enabled         bool                         `json:"enabled"`
	Priority        int                          `json:"priority"`
	PolicyID        *string                      `json:"policy_id"`
	LogicMode       string                       `json:"logic_mode"`
	Conditions      []CreateRuleConditionRequest `json:"conditions"`
	Action          string                       `json:"action"`
	ResponseCode    *int                         `json:"response_code"`
	CustomResponse  string                       `json:"custom_response"`
	LogEvent        bool                         `json:"log_event"`
	AddToReputation bool                         `json:"add_to_reputation"`
	SourceIP        string                       `json:"source_ip"`
	HostDomain      string                       `json:"host_domain"`
	PathPrefix      string                       `json:"path_prefix"`
	HTTPMethod      string                       `json:"http_method"`
}

type CreateRuleConditionRequest struct {
	Field      string `json:"field"`
	Operator   string `json:"operator"`
	Value      string `json:"value"`
	HeaderName string `json:"header_name"`
}
