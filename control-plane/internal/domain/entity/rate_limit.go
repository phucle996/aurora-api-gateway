package entity

// RateLimitIpConfig chứa cấu hình cho dimension Client IP trong tầng Domain.
type RateLimitIpConfig struct {
	Source     string
	SubnetMask string
}

// RateLimitHeaderConfig chứa cấu hình cho dimension Header Match trong tầng Domain.
type RateLimitHeaderConfig struct {
	HeaderName    string
	Operator      string
	HeaderValue   string
	CaseSensitive bool
}

// RateLimitPathConfig chứa cấu hình cho dimension Path Scope trong tầng Domain.
type RateLimitPathConfig struct {
	Path      string
	MatchType string
}

// CreateRateLimitRuleCommand đại diện cho payload yêu cầu tạo mới một Rate Limit Rule.
// Tuân thủ Flat Entity: không chứa json tags.
type CreateRateLimitRuleCommand struct {
	Name              string
	Description       string
	EnabledDimensions []string
	DimensionOrder    []string
	IpConfig          RateLimitIpConfig
	HeaderConfig      RateLimitHeaderConfig
	PathConfig        RateLimitPathConfig
	RateLimit         int
	RateUnit          string
	Burst             int
	ActionExceeded    string
	CustomResponse    bool
	ResponseCode      int
	ResponseBody      string
	LogEvents         bool
	AddReputation     bool
	EnableAlert       bool
	Status            string
	CreatedBy         string
}

// UpdateRateLimitRuleCommand đại diện cho payload yêu cầu cập nhật một Rate Limit Rule.
// Tuân thủ Flat Entity: không chứa json tags.
type UpdateRateLimitRuleCommand struct {
	ID                int64
	Name              string
	Description       string
	EnabledDimensions []string
	DimensionOrder    []string
	IpConfig          RateLimitIpConfig
	HeaderConfig      RateLimitHeaderConfig
	PathConfig        RateLimitPathConfig
	RateLimit         int
	RateUnit          string
	Burst             int
	ActionExceeded    string
	CustomResponse    bool
	ResponseCode      int
	ResponseBody      string
	LogEvents         bool
	AddReputation     bool
	EnableAlert       bool
	Status            string
}

// RateLimitRuleItem là flat projection của một bản ghi Rate Limit Rule trong tầng Domain.
type RateLimitRuleItem struct {
	ID                int64
	Name              string
	Description       string
	EnabledDimensions []string
	DimensionOrder    []string
	IpConfig          RateLimitIpConfig
	HeaderConfig      RateLimitHeaderConfig
	PathConfig        RateLimitPathConfig
	RateLimit         int
	RateUnit          string
	Burst             int
	ActionExceeded    string
	CustomResponse    bool
	ResponseCode      int
	ResponseBody      string
	LogEvents         bool
	AddReputation     bool
	EnableAlert       bool
	Status            string
	CreatedBy         string
	CreatedAt         string
	UpdatedAt         string
}

// ListRateLimitRulesQuery biểu diễn các tiêu chí truy vấn danh sách Rate Limit Rules.
type ListRateLimitRulesQuery struct {
	Search string
	Status string
	Limit  int
	Offset int
}

// ListRateLimitRulesResult là kết quả trả về của workflow List Rate Limit Rules.
type ListRateLimitRulesResult struct {
	Items         []RateLimitRuleItem
	TotalFiltered int
}

// RateLimitStatsSummary là flat projection cho thẻ thống kê tổng quan của Rate Limiting.
type RateLimitStatsSummary struct {
	Mode               string
	TotalHits          int64
	TotalBlocked       int64
	TotalThrottled     int64
	AvgLatencyMs       float64
	HitsChangePct      float64
	BlockedChangePct   float64
	ThrottledChangePct float64
	LatencyChangePct   float64
}

// RateLimitHourlyMetricItem biểu diễn một điểm dữ liệu trên biểu đồ theo thời gian.
type RateLimitHourlyMetricItem struct {
	Timestamp      string
	TotalHits      int64
	BlockedCount   int64
	ThrottledCount int64
}

// RateLimitTopEndpointItem biểu diễn thông số của một endpoint bị nhắm đến nhiều nhất.
type RateLimitTopEndpointItem struct {
	Endpoint   string
	Method     string
	RuleName   string
	Requests   int64
	Blocked    int64
	BlockRatio float64
}

// RateLimitMetricsResult là tập hợp số liệu biểu đồ và top endpoints.
type RateLimitMetricsResult struct {
	Mode           string
	VelocitySeries []RateLimitHourlyMetricItem
	TopEndpoints   []RateLimitTopEndpointItem
}

// RateLimitHourlyMetricSample chứa mẫu dữ liệu tổng hợp theo giờ để batch sync.
type RateLimitHourlyMetricSample struct {
	HourBucket     string
	TotalHits      int64
	BlockedCount   int64
	ThrottledCount int64
}

// RateLimitEndpointMetricSample chứa mẫu dữ liệu tổng hợp theo endpoint để batch sync.
type RateLimitEndpointMetricSample struct {
	HourBucket   string
	Endpoint     string
	Method       string
	RuleName     string
	RequestCount int64
	BlockedCount int64
}
