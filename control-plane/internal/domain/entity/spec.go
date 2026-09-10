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
	Status        string
	Target        string
	Algorithm     string
	ServersJSON   string
	TransportJSON string
	SSLJSON       string
	ProbesJSON    string
	DynamicDNS    bool
}

// SpecExtensionRecord is the flat projection for an extension in the catalog.
type SpecExtensionRecord struct {
	ID         string
	Name       string
	Category   string
	Enabled    bool
	ConfigJSON string
}

// SpecAuthorityData is the spec sync workflow's flat database authority projection.
type SpecAuthorityData struct {
	NodeID          string
	WAFReleaseID    int64
	WAFPayload      []byte
	AccessReleaseID int64
	AccessPayload   []byte
	UpstreamsConf   string
	RoutingRecords  []SpecRoutingRecord
	Extensions      []SpecExtensionRecord
}

type NodeSpecDocument struct {
	Version       uint32                            `yaml:"version" json:"version"`
	ReleaseID     int64                             `yaml:"release_id" json:"release_id"`
	GeneratedAt   string                            `yaml:"generated_at" json:"generated_at"`
	NodeID        string                            `yaml:"node_id" json:"node_id"`
	Extensions    map[string]map[string]interface{} `yaml:"extensions" json:"extensions"`
	WAF           WAFSpec                           `yaml:"waf" json:"waf"`
	Access        AccessSpec                        `yaml:"access" json:"access"`
	Upstreams     []UpstreamSpec                    `yaml:"upstreams,omitempty" json:"upstreams,omitempty"`
	UpstreamsConf string                            `yaml:"upstreams_conf,omitempty" json:"upstreams_conf,omitempty"`
	Routing       RoutingSpec                       `yaml:"routing,omitempty" json:"routing,omitempty"`
	RoutingConf   string                            `yaml:"routing_conf,omitempty" json:"routing_conf,omitempty"`
}

type ExtensionsSpec struct {
	Metrics *MetricsExtensionSpec `yaml:"metrics,omitempty" json:"metrics,omitempty"`
}

type MetricsExtensionSpec struct {
	Enabled       bool            `yaml:"enabled" json:"enabled"`
	Port          uint16          `yaml:"port" json:"port"`
	StubStatusURL string          `yaml:"stub_status_url,omitempty" json:"stub_status_url,omitempty"`
	Prometheus    *PrometheusSpec `yaml:"prometheus,omitempty" json:"prometheus,omitempty"`
	OTLP          *OTLPSpec       `yaml:"otlp,omitempty" json:"otlp,omitempty"`
}

type PrometheusSpec struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Path    string `yaml:"path" json:"path"`
}

type OTLPSpec struct {
	Enabled      bool   `yaml:"enabled" json:"enabled"`
	Endpoint     string `yaml:"endpoint" json:"endpoint"`
	IntervalSecs uint64 `yaml:"interval_secs" json:"interval_secs"`
}

type WAFSpec struct {
	Mode       string   `yaml:"mode" json:"mode"`
	BlockPaths []string `yaml:"block_paths,omitempty" json:"block_paths,omitempty"`
	RawJSON    string   `yaml:"raw_json,omitempty" json:"raw_json,omitempty"`
}

type AccessSpec struct {
	RawJSON string `yaml:"raw_json,omitempty" json:"raw_json,omitempty"`
}

type UpstreamSpec struct {
	Name    string               `yaml:"name" json:"name"`
	Servers []UpstreamServerSpec `yaml:"servers" json:"servers"`
}

type UpstreamServerSpec struct {
	Addr   string `yaml:"addr" json:"addr"`
	Weight uint32 `yaml:"weight" json:"weight"`
}

type RoutingSpec struct {
	Domains []DomainRoutingSpec `yaml:"domains,omitempty" json:"domains,omitempty"`
}

type DomainRoutingSpec struct {
	Host      string                `yaml:"host" json:"host"`
	Locations []LocationRoutingSpec `yaml:"locations,omitempty" json:"locations,omitempty"`
}

type LocationRoutingSpec struct {
	Path     string `yaml:"path" json:"path"`
	Upstream string `yaml:"upstream" json:"upstream"`
}
