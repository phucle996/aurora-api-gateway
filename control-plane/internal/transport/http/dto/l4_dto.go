package dto

// ─── L4 SERVICE DTOs ───────────────────────────────────────────────────────────

type CreateL4ServiceRequest struct {
	Name                string `json:"name" binding:"required"`
	Protocol            string `json:"protocol"` // "tcp" or "udp" (default "tcp")
	ListenPort          int    `json:"listen_port" binding:"required"`
	ForwardTargetType   string `json:"forward_target_type"` // "upstream" | "endpoint"
	UpstreamName        string `json:"upstream_name"`
	DirectEndpoint      string `json:"direct_endpoint"`
	ACLRulesJSON        string `json:"acl_rules_json"`
	ProxyTimeout        string `json:"proxy_timeout"`
	ProxyConnectTimeout string `json:"proxy_connect_timeout"`
	Enabled             *bool  `json:"enabled"`
	Description         string `json:"description"`
}

type UpdateL4ServiceRequest struct {
	Name                string `json:"name" binding:"required"`
	Protocol            string `json:"protocol"`
	ListenPort          int    `json:"listen_port" binding:"required"`
	ForwardTargetType   string `json:"forward_target_type"`
	UpstreamName        string `json:"upstream_name"`
	DirectEndpoint      string `json:"direct_endpoint"`
	ACLRulesJSON        string `json:"acl_rules_json"`
	ProxyTimeout        string `json:"proxy_timeout"`
	ProxyConnectTimeout string `json:"proxy_connect_timeout"`
	Enabled             *bool  `json:"enabled"`
	Description         string `json:"description"`
}

type ToggleL4ServiceStatusRequest struct {
	Enabled bool `json:"enabled"`
}

type L4ServiceResponse struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Protocol            string `json:"protocol"`
	ListenPort          int    `json:"listen_port"`
	ForwardTargetType   string `json:"forward_target_type"`
	UpstreamName        string `json:"upstream_name"`
	DirectEndpoint      string `json:"direct_endpoint"`
	ACLRulesJSON        string `json:"acl_rules_json"`
	ProxyTimeout        string `json:"proxy_timeout"`
	ProxyConnectTimeout string `json:"proxy_connect_timeout"`
	Enabled             bool   `json:"enabled"`
	Description         string `json:"description"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

type ListL4ServicesResponse struct {
	Items []L4ServiceResponse `json:"items"`
	Total int                 `json:"total"`
}
