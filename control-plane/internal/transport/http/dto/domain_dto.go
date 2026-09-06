package dto

// ListDomainsQueryRequest đại diện cho các query params gửi lên từ HTTP transport.
type ListDomainsQueryRequest struct {
	Search  string `form:"search"`
	Status  string `form:"status"`
	TLSType string `form:"tls_type"`
	Tag     string `form:"tag"`
	Page    int    `form:"page,default=1"`
	Limit   int    `form:"limit,default=10"`
}

// DomainItemDTO đại diện cho cấu trúc JSON của một domain trả về client.
type DomainItemDTO struct {
	ID                int64    `json:"id"`
	Domain            string   `json:"domain"`
	RootDomain        string   `json:"root_domain"`
	Status            string   `json:"status"`
	TLSType           string   `json:"tls_type"`
	TLSExpiry         string   `json:"tls_expiry"`
	TLSAutoRenew      bool     `json:"tls_auto_renew"`
	MinTLSVersion     string   `json:"min_tls_version"`
	HSTSEnabled       bool     `json:"hsts_enabled"`
	OCSPStapling      bool     `json:"ocsp_stapling"`
	ClientCASubject   string   `json:"client_ca_subject"`
	Upstream          string   `json:"upstream"`
	UpstreamAlgorithm string   `json:"upstream_algorithm"`
	HealthCheckPath   string   `json:"health_check_path"`
	Tags              []string `json:"tags"`
	Description       string   `json:"description"`
	RulesCount        int      `json:"rules_count"`
	PoliciesCount     int      `json:"policies_count"`
	IPRulesCount      int      `json:"ip_rules_count"`
	RateLimitsCount   int      `json:"rate_limits_count"`
	CreatedBy         string   `json:"created_by"`
	CreatedAt         string   `json:"created_at"`
	UpdatedAt         string   `json:"updated_at"`
}

// DomainCountsDTO đại diện cho thống kê 4 thẻ cards ở tầng transport.
type DomainCountsDTO struct {
	Total       int `json:"total"`
	Active      int `json:"active"`
	Inactive    int `json:"inactive"`
	MTLSEnabled int `json:"mtls_enabled"`
}

// ListDomainsResponse là HTTP response payload trả về cho client.
type ListDomainsResponse struct {
	Items         []DomainItemDTO `json:"items"`
	Counts        DomainCountsDTO `json:"counts"`
	TotalFiltered int             `json:"total_filtered"`
	Page          int             `json:"page"`
	Limit         int             `json:"limit"`
}
