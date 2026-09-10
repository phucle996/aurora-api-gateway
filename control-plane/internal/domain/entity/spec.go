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
