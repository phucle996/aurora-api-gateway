package entity

type SpecSyncQuery struct {
	NodeID      string
	CurrentHash string
}

type SpecSyncResult struct {
	InSync    bool
	ReleaseID int64
	Hash      string
	SpecYAML  string
}

type SpecReportCommand struct {
	NodeID    string
	ReleaseID int64
	Hash      string
	Status    string
	Message   string
}

// ClusterSpecRelease represents an immutable compiled release of the cluster NodeSpec.
type ClusterSpecRelease struct {
	ID            int64  `json:"id"`
	Digest        string `json:"digest"`
	SpecYAML      string `json:"spec_yaml"`
	Actor         string `json:"actor"`
	ChangeSummary string `json:"change_summary"`
	CreatedAt     string `json:"created_at"`
}

// SpecRoutingRecord is the spec sync workflow's flat projection for domain routing rules.
type SpecRoutingRecord struct {
	ID            int64
	Host          string
	Path          string
	Status        string
	Target        string
	Algorithm     string
	ServersJSON   string
	TransportJSON string
	SSLJSON       string
	ProbesJSON    string
	DynamicDNS    bool
	StripPath     bool
	WebSocket     bool
	Priority      int
	PluginsJSON   string
}

// SpecCertificateRecord is the spec sync workflow's flat projection for active SSL certificates.
type SpecCertificateRecord struct {
	ID          string
	Name        string
	SNIsJSON    string
	CertPEM     string
	KeyPEM      string
	MTLSEnabled bool
	ClientCAPEM string
	VerifyDepth int
}

// SpecExtensionRecord is the spec workflow's durable extension-instance projection.
type SpecExtensionRecord struct {
	ID              string
	ManifestKey     string
	ManifestVersion uint32
	ConfigJSON      string
}

// SpecUnifiedUpstreamRecord is the spec sync workflow's flat projection for an upstream pool.
type SpecUnifiedUpstreamRecord struct {
	ID          int64
	Name        string
	Algorithm   string
	ServersJSON string
}

// SpecL4ServiceRecord is the spec sync workflow's flat projection for an L4 service.
type SpecL4ServiceRecord struct {
	ID                  string
	Name                string
	Protocol            string
	ListenPort          int
	ForwardTargetType   string
	UpstreamName        string
	DirectEndpoint      string
	ACLRulesJSON        string
	ProxyTimeout        string
	ProxyConnectTimeout string
	Enabled             bool
}

// SpecAuthorityData is the spec sync workflow's flat database authority projection.
type SpecAuthorityData struct {
	NodeID          string
	WAFReleaseID    int64
	WAFPayload      []byte
	UpstreamsConf   string
	RoutingRecords  []SpecRoutingRecord
	Certificates    []SpecCertificateRecord
	Extensions      []SpecExtensionRecord
	UpstreamRecords []SpecUnifiedUpstreamRecord
	L4Services      []SpecL4ServiceRecord
}
