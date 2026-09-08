package dto

// RateLimitIpConfigRequest định nghĩa cấu trúc Client IP config nhận từ HTTP request payload.
type RateLimitIpConfigRequest struct {
	Source     string `json:"source"`
	SubnetMask string `json:"subnet_mask"`
}

// RateLimitHeaderConfigRequest định nghĩa cấu trúc Header Match config nhận từ HTTP request payload.
type RateLimitHeaderConfigRequest struct {
	HeaderName    string `json:"header_name"`
	Operator      string `json:"operator"`
	HeaderValue   string `json:"header_value"`
	CaseSensitive bool   `json:"case_sensitive"`
}

// RateLimitPathConfigRequest định nghĩa cấu trúc Path Scope config nhận từ HTTP request payload.
type RateLimitPathConfigRequest struct {
	Path      string `json:"path"`
	MatchType string `json:"match_type"`
}

// CreateRateLimitRuleRequest định nghĩa HTTP payload tạo mới Rate Limit Rule.
type CreateRateLimitRuleRequest struct {
	Name              string                       `json:"name" binding:"required,min=1,max=120"`
	Description       string                       `json:"description"`
	EnabledDimensions []string                     `json:"enabled_dimensions"`
	DimensionOrder    []string                     `json:"dimension_order"`
	IpConfig          RateLimitIpConfigRequest     `json:"ip_config"`
	HeaderConfig      RateLimitHeaderConfigRequest `json:"header_config"`
	PathConfig        RateLimitPathConfigRequest   `json:"path_config"`
	RateLimit         int                          `json:"rate_limit" binding:"required,gt=0"`
	RateUnit          string                       `json:"rate_unit"`
	Burst             int                          `json:"burst"`
	ActionExceeded    string                       `json:"action_exceeded"`
	CustomResponse    bool                         `json:"custom_response"`
	ResponseCode      int                          `json:"response_code"`
	ResponseBody      string                       `json:"response_body"`
	LogEvents         bool                         `json:"log_events"`
	AddReputation     bool                         `json:"add_reputation"`
	EnableAlert       bool                         `json:"enable_alert"`
	Status            string                       `json:"status"`
}

// UpdateRateLimitRuleRequest định nghĩa HTTP payload cập nhật Rate Limit Rule.
type UpdateRateLimitRuleRequest struct {
	Name              string                       `json:"name"`
	Description       string                       `json:"description"`
	EnabledDimensions []string                     `json:"enabled_dimensions"`
	DimensionOrder    []string                     `json:"dimension_order"`
	IpConfig          RateLimitIpConfigRequest     `json:"ip_config"`
	HeaderConfig      RateLimitHeaderConfigRequest `json:"header_config"`
	PathConfig        RateLimitPathConfigRequest   `json:"path_config"`
	RateLimit         int                          `json:"rate_limit"`
	RateUnit          string                       `json:"rate_unit"`
	Burst             int                          `json:"burst"`
	ActionExceeded    string                       `json:"action_exceeded"`
	CustomResponse    bool                         `json:"custom_response"`
	ResponseCode      int                          `json:"response_code"`
	ResponseBody      string                       `json:"response_body"`
	LogEvents         bool                         `json:"log_events"`
	AddReputation     bool                         `json:"add_reputation"`
	EnableAlert       bool                         `json:"enable_alert"`
	Status            string                       `json:"status"`
}

// ListRateLimitRulesQueryRequest định nghĩa query params lọc và phân trang.
type ListRateLimitRulesQueryRequest struct {
	Search string `form:"search"`
	Status string `form:"status"`
	Page   int    `form:"page"`
	Limit  int    `form:"limit"`
}
