package dto

// UpstreamNodeRequest biểu diễn dữ liệu đầu vào của một backend server trong request.
type UpstreamNodeRequest struct {
	ID          string `json:"id"`
	Address     string `json:"address"`
	Weight      int    `json:"weight"`
	MaxFails    int    `json:"maxFails,omitempty"`
	FailTimeout string `json:"failTimeout,omitempty"`
	Backup      bool   `json:"backup,omitempty"`
	Healthy     bool   `json:"healthy"`
}

// UpstreamProbeRequest biểu diễn cấu hình kiểm tra sức khỏe backend trong request.
type UpstreamProbeRequest struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Path           string `json:"path"`
	ExpectedStatus int    `json:"expectedStatus"`
	IntervalSec    int    `json:"intervalSec,omitempty"`
	TimeoutSec     int    `json:"timeoutSec,omitempty"`
}

// UpstreamInternalSSLRequest biểu diễn cấu hình TLS tới origin trong request.
type UpstreamInternalSSLRequest struct {
	Enabled             bool   `json:"enabled"`
	VerifyCert          bool   `json:"verifyCert"`
	SNIHost             string `json:"sniHost,omitempty"`
	CACert              string `json:"caCert,omitempty"`
	MTLS                bool   `json:"mTLS"`
	ClientCertName      string `json:"clientCertName,omitempty"`
	ClientCert          string `json:"clientCert,omitempty"`
	ClientKey           string `json:"clientKey,omitempty"`
	ClientKeyConfigured bool   `json:"clientKeyConfigured,omitempty"`
}

// UpstreamTransportRequest biểu diễn cấu hình giao thức truyền tải trong request.
type UpstreamTransportRequest struct {
	RequestCompression   string `json:"requestCompression"`
	CompressionMinBytes  int    `json:"compressionMinBytes"`
	CompressionLevel     int    `json:"compressionLevel"`
	HTTPVersion          string `json:"httpVersion"`
	EnableWebSocket      bool   `json:"enableWebSocket"`
	EnableSSE            bool   `json:"enableSse"`
	EnableGRPC           bool   `json:"enableGrpc"`
	KeepAliveConnections int    `json:"keepAliveConnections,omitempty"`
	KeepAliveTimeout     int    `json:"keepAliveTimeout,omitempty"`
}

// CreateUpstreamRequest là cấu trúc JSON đầu vào cho endpoint tạo mới Upstream Pool.
type CreateUpstreamRequest struct {
	Name             string                     `json:"name" binding:"required"`
	Description      string                     `json:"description"`
	ArchitectureType string                     `json:"architecture_type"`
	Algorithm        string                     `json:"algorithm"`
	Servers          []UpstreamNodeRequest      `json:"servers"`
	ExternalFQDN     string                     `json:"external_fqdn"`
	SNIOverride      bool                       `json:"sni_override"`
	DynamicDNS       bool                       `json:"dynamic_dns"`
	InternalSSL      UpstreamInternalSSLRequest `json:"internal_ssl"`
	Probes           []UpstreamProbeRequest     `json:"probes"`
	Transport        UpstreamTransportRequest   `json:"transport"`
}

// UpdateUpstreamRequest là cấu trúc JSON đầu vào cho endpoint cập nhật Upstream Pool.
type UpdateUpstreamRequest struct {
	Name             string                     `json:"name" binding:"required"`
	Description      string                     `json:"description"`
	ArchitectureType string                     `json:"architecture_type"`
	Algorithm        string                     `json:"algorithm"`
	Servers          []UpstreamNodeRequest      `json:"servers"`
	ExternalFQDN     string                     `json:"external_fqdn"`
	SNIOverride      bool                       `json:"sni_override"`
	DynamicDNS       bool                       `json:"dynamic_dns"`
	InternalSSL      UpstreamInternalSSLRequest `json:"internal_ssl"`
	Probes           []UpstreamProbeRequest     `json:"probes"`
	Transport        UpstreamTransportRequest   `json:"transport"`
}

// ListUpstreamsQueryRequest là query parameters khi truy vấn danh sách upstream.
type ListUpstreamsQueryRequest struct {
	Search           string `form:"search"`
	ArchitectureType string `form:"type"`
	Page             int    `form:"page,default=1"`
	Limit            int    `form:"limit,default=20"`
}

// UpstreamSyncReportRequest là payload báo cáo đồng bộ gửi từ NGINX Data Plane node.
type UpstreamSyncReportRequest struct {
	ReleaseID int64  `json:"release_id" binding:"required"`
	Phase     string `json:"phase" binding:"required"`
	Message   string `json:"message"`
}
