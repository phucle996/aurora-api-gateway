package entity

// ListDomainsQuery biểu diễn các tiêu chí truy vấn danh sách Domain theo workflow.
// Tuân thủ Flat Entity: chỉ chứa các trường filter và phân trang thuần túy trong tầng Domain.
type ListDomainsQuery struct {
	Search  string
	Status  string
	TLSType string
	Tag     string
	Limit   int
	Offset  int
}

// ListDomainsItem là flat projection của một bản ghi Domain thuần túy trong tầng Domain.
type ListDomainsItem struct {
	ID                int64
	Domain            string
	RootDomain        string
	Status            string
	TLSType           string
	TLSExpiry         string
	TLSAutoRenew      bool
	MinTLSVersion     string
	HSTSEnabled       bool
	OCSPStapling      bool
	ClientCASubject   string
	Upstream          string
	UpstreamAlgorithm string
	HealthCheckPath   string
	Tags              []string
	Description       string
	RulesCount        int
	PoliciesCount     int
	IPRulesCount      int
	RateLimitsCount   int
	CreatedBy         string
	CreatedAt         string
	UpdatedAt         string
}

// ListDomainsCounts chứa các số liệu thống kê tổng hợp phục vụ 4 stat cards.
type ListDomainsCounts struct {
	Total       int
	Active      int
	Inactive    int
	MTLSEnabled int
}

// ListDomainsResult là kết quả trả về của workflow List Domains trong tầng Domain.
type ListDomainsResult struct {
	Items         []ListDomainsItem
	Counts        ListDomainsCounts
	TotalFiltered int
}
