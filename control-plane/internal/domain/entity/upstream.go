package entity

// Tuân thủ Flat Entity: không chứa json tags.

// UpstreamNode mô tả một máy chủ backend trong pool.
type UpstreamNode struct {
	ID          string
	Address     string
	Weight      int
	MaxFails    int
	FailTimeout string
	Backup      bool
	Healthy     bool
}

// UpstreamProbe cấu hình kiểm tra sức khoẻ backend (Readiness / Liveness / Health).
type UpstreamProbe struct {
	ID             string
	Type           string
	Path           string
	ExpectedStatus int
	IntervalSec    int
	TimeoutSec     int
}

// UpstreamInternalSSL cấu hình mã hoá nội bộ từ NGINX tới Backend origin.
type UpstreamInternalSSL struct {
	Enabled             bool
	VerifyCert          bool
	SNIHost             string
	CACert              string
	MTLS                bool
	ClientCertName      string
	ClientCert          string
	ClientKey           string
	ClientKeyConfigured bool
}

// UpstreamTransport cấu hình giao thức và kết nối.
type UpstreamTransport struct {
	RequestCompression   string
	CompressionMinBytes  int
	CompressionLevel     int
	HTTPVersion          string
	EnableWebSocket      bool
	EnableSSE            bool
	EnableGRPC           bool
	KeepAliveConnections int
	KeepAliveTimeout     int
}

// UpstreamItem là flat projection entity đại diện cho một Upstream Pool.
type UpstreamItem struct {
	ID                int64
	Name              string
	Description       string
	ArchitectureType  string
	Algorithm         string
	Servers           []UpstreamNode
	ExternalFQDN      string
	SNIOverride       bool
	DynamicDNS        bool
	InternalSSL       UpstreamInternalSSL
	Probes            []UpstreamProbe
	Transport         UpstreamTransport
	Version           int
	BoundDomainsCount int
	CreatedAt         string
	UpdatedAt         string
}

// CreateUpstreamCommand chứa các tham số đầu vào để tạo mới một Upstream Pool.
type CreateUpstreamCommand struct {
	Name             string
	Description      string
	ArchitectureType string
	Algorithm        string
	Servers          []UpstreamNode
	ExternalFQDN     string
	SNIOverride      bool
	DynamicDNS       bool
	InternalSSL      UpstreamInternalSSL
	Probes           []UpstreamProbe
	Transport        UpstreamTransport
}

// UpdateUpstreamCommand chứa các tham số đầu vào để cập nhật một Upstream Pool đã có.
type UpdateUpstreamCommand struct {
	ExpectedVersion  int
	ID               int64
	Name             string
	Description      string
	ArchitectureType string
	Algorithm        string
	Servers          []UpstreamNode
	ExternalFQDN     string
	SNIOverride      bool
	DynamicDNS       bool
	InternalSSL      UpstreamInternalSSL
	Probes           []UpstreamProbe
	Transport        UpstreamTransport
}

// ListUpstreamsQuery chứa bộ lọc danh sách upstream.
type ListUpstreamsQuery struct {
	Search           string
	ArchitectureType string
	Limit            int
	Offset           int
}

// UpstreamSnapshot chứa gói snapshot upstream phục vụ đồng bộ tới NGINX Data-Plane qua FFI.
type UpstreamSnapshot struct {
	ReleaseID     int64
	Digest        string
	Upstreams     []UpstreamItem
	ConfigContent string
}
