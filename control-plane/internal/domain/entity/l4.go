package entity

// Tuân thủ Flat Entity: không chứa json tags.

// L4ACLRule biểu diễn một quy tắc kiểm soát truy cập IP/CIDR ở tầng L4.
type L4ACLRule struct {
	CIDR        string
	Action      string // "allow" | "deny"
	Description string
}

// L4ServiceItem là flat projection entity đại diện cho một L4 Service (Port Listener & ACL).
type L4ServiceItem struct {
	ID                  string
	Name                string
	Protocol            string
	ListenPort          int
	ForwardTargetType   string // "upstream" | "endpoint"
	UpstreamName        string
	DirectEndpoint      string
	ACLRulesJSON        string
	ProxyTimeout        string
	ProxyConnectTimeout string
	Enabled             bool
	Description         string
	CreatedAt           string
	UpdatedAt           string
}

// CreateL4ServiceCommand chứa dữ liệu tạo mới L4 Service.
type CreateL4ServiceCommand struct {
	ID                  string
	Name                string
	Protocol            string
	ListenPort          int
	ForwardTargetType   string // "upstream" | "endpoint"
	UpstreamName        string
	DirectEndpoint      string
	ACLRulesJSON        string
	ProxyTimeout        string
	ProxyConnectTimeout string
	Enabled             bool
	Description         string
}

// UpdateL4ServiceCommand chứa dữ liệu cập nhật L4 Service.
type UpdateL4ServiceCommand struct {
	ID                  string
	Name                string
	Protocol            string
	ListenPort          int
	ForwardTargetType   string // "upstream" | "endpoint"
	UpstreamName        string
	DirectEndpoint      string
	ACLRulesJSON        string
	ProxyTimeout        string
	ProxyConnectTimeout string
	Enabled             bool
	Description         string
}

// ListL4ServicesQuery chứa điều kiện tìm kiếm L4 Services.
type ListL4ServicesQuery struct {
	Search   string
	Protocol string
	Limit    int
	Offset   int
}
