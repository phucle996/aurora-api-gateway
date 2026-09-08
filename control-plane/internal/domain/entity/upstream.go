package entity

// UpstreamNode mô tả một máy chủ backend trong pool.
type UpstreamNode struct {
	ID          string `json:"id"`
	Address     string `json:"address"`
	Weight      int    `json:"weight"`
	MaxFails    int    `json:"maxFails,omitempty"`
	FailTimeout string `json:"failTimeout,omitempty"`
	Backup      bool   `json:"backup,omitempty"`
	Healthy     bool   `json:"healthy"`
}

// UpstreamProbe cấu hình kiểm tra sức khoẻ backend (Readiness / Liveness / Health).
type UpstreamProbe struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Path           string `json:"path"`
	ExpectedStatus int    `json:"expectedStatus"`
	IntervalSec    int    `json:"intervalSec,omitempty"`
	TimeoutSec     int    `json:"timeoutSec,omitempty"`
}

// UpstreamInternalSSL cấu hình mã hoá nội bộ từ NGINX tới Backend origin.
type UpstreamInternalSSL struct {
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

// UpstreamTransport cấu hình giao thức và kết nối.
type UpstreamTransport struct {
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

// UpstreamItem là flat projection entity đại diện cho một Upstream Pool.
type UpstreamItem struct {
	ID                int64               `json:"id"`
	Name              string              `json:"name"`
	Description       string              `json:"description"`
	ArchitectureType  string              `json:"architecture_type"`
	Algorithm         string              `json:"algorithm"`
	Servers           []UpstreamNode      `json:"servers"`
	ExternalFQDN      string              `json:"external_fqdn,omitempty"`
	SNIOverride       bool                `json:"sni_override"`
	DynamicDNS        bool                `json:"dynamic_dns"`
	InternalSSL       UpstreamInternalSSL `json:"internal_ssl"`
	Probes            []UpstreamProbe     `json:"probes"`
	Transport         UpstreamTransport   `json:"transport"`
	Version           int                 `json:"version"`
	BoundDomainsCount int                 `json:"bound_domains_count"`
	CreatedAt         string              `json:"created_at"`
	UpdatedAt         string              `json:"updated_at"`
}

// CreateUpstreamCommand chứa các tham số đầu vào để tạo mới một Upstream Pool.
type CreateUpstreamCommand struct {
	Name             string              `json:"name"`
	Description      string              `json:"description"`
	ArchitectureType string              `json:"architecture_type"`
	Algorithm        string              `json:"algorithm"`
	Servers          []UpstreamNode      `json:"servers"`
	ExternalFQDN     string              `json:"external_fqdn"`
	SNIOverride      bool                `json:"sni_override"`
	DynamicDNS       bool                `json:"dynamic_dns"`
	InternalSSL      UpstreamInternalSSL `json:"internal_ssl"`
	Probes           []UpstreamProbe     `json:"probes"`
	Transport        UpstreamTransport   `json:"transport"`
}

// UpdateUpstreamCommand chứa các tham số đầu vào để cập nhật một Upstream Pool đã có.
type UpdateUpstreamCommand struct {
	ExpectedVersion  int                 `json:"-"`
	ID               int64               `json:"id"`
	Name             string              `json:"name"`
	Description      string              `json:"description"`
	ArchitectureType string              `json:"architecture_type"`
	Algorithm        string              `json:"algorithm"`
	Servers          []UpstreamNode      `json:"servers"`
	ExternalFQDN     string              `json:"external_fqdn"`
	SNIOverride      bool                `json:"sni_override"`
	DynamicDNS       bool                `json:"dynamic_dns"`
	InternalSSL      UpstreamInternalSSL `json:"internal_ssl"`
	Probes           []UpstreamProbe     `json:"probes"`
	Transport        UpstreamTransport   `json:"transport"`
}

// ListUpstreamsQuery chứa bộ lọc danh sách upstream.
type ListUpstreamsQuery struct {
	Search           string `json:"search"`
	ArchitectureType string `json:"architecture_type"`
	Limit            int    `json:"limit"`
	Offset           int    `json:"offset"`
}

// UpstreamSnapshot chứa gói snapshot upstream phục vụ đồng bộ tới NGINX Data-Plane qua FFI.
type UpstreamSnapshot struct {
	ReleaseID     int64          `json:"release_id"`
	Digest        string         `json:"digest"`
	Upstreams     []UpstreamItem `json:"upstreams"`
	ConfigContent string         `json:"config_content"`
}
