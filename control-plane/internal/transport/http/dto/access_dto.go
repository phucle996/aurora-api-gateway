package dto

import "encoding/json"

// AccessChangeRequest represents an administrative request to mutate access objects (rules, groups, datasets).
type AccessChangeRequest struct {
	ID              int64           `json:"id"`
	Kind            string          `json:"kind"`
	ExpectedVersion int64           `json:"expected_version"`
	ExpectedRelease int64           `json:"expected_release"`
	Delete          bool            `json:"delete"`
	Document        json.RawMessage `json:"document"`
}

// AccessChangeResponse returns the updated object ID, version and new compiled release ID.
type AccessChangeResponse struct {
	ID        int64 `json:"id"`
	Version   int64 `json:"version"`
	ReleaseID int64 `json:"release_id"`
}

// AccessReadItemResponse represents an immutable version of an access object.
type AccessReadItemResponse struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	Version   int64           `json:"version"`
	Document  json.RawMessage `json:"document"`
	Deleted   bool            `json:"deleted"`
	UpdatedAt string          `json:"updated_at"`
	Actor     string          `json:"actor"`
}

// AccessStatusNodeResponse represents an edge node's current release synchronization phase.
type AccessStatusNodeResponse struct {
	ID        string `json:"id"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
}

// AccessStatusResponse aggregates the active release ID and all edge nodes' sync states.
type AccessStatusResponse struct {
	ReleaseID int64                      `json:"release_id"`
	Nodes     []AccessStatusNodeResponse `json:"nodes"`
}

// AccessSyncResponse returns the active compiled snapshot and cryptographic digest.
type AccessSyncResponse struct {
	ReleaseID int64           `json:"release_id"`
	Digest    string          `json:"digest"`
	Payload   json.RawMessage `json:"payload"`
}

// AccessReportRequest reports node deployment status transition.
type AccessReportRequest struct {
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
}

// AccessMatchRequest reports sampled rule matches observed on an edge node.
type AccessMatchRequest struct {
	Key       string `json:"key"`
	ReleaseID int64  `json:"release_id"`
	RuleID    int64  `json:"rule_id"`
	IP        string `json:"ip"`
}

// AccessActivityItemResponse represents an access decision event with calculated reputation risk score.
type AccessActivityItemResponse struct {
	RiskScore  int    `json:"risk_score"`
	NodeID     string `json:"node_id"`
	RuleID     int64  `json:"rule_id"`
	ReleaseID  int64  `json:"release_id"`
	IP         string `json:"ip"`
	Action     string `json:"action"`
	Reputation bool   `json:"reputation"`
	Alert      bool   `json:"alert"`
	CreatedAt  string `json:"created_at"`
}

// AccessCatalogCountryResponse provides available country codes and mapped CIDR counts from imported datasets.
type AccessCatalogCountryResponse struct {
	Code      string `json:"code"`
	CIDRCount int    `json:"cidr_count"`
}

// AccessCatalogASNResponse provides available Autonomous System Numbers and mapped CIDR counts.
type AccessCatalogASNResponse struct {
	ASN       string `json:"asn"`
	CIDRCount int    `json:"cidr_count"`
}

// AccessCatalogResponse provides real cluster metadata for IP & Access rule configuration.
type AccessCatalogResponse struct {
	Hosts     []string                       `json:"hosts"`
	Countries []AccessCatalogCountryResponse `json:"countries"`
	ASNs      []AccessCatalogASNResponse     `json:"asns"`
}

// AccessRuleDocument defines the transport schema for an access rule document payload.
type AccessRuleDocument struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Action      string   `json:"action"`
	Enabled     bool     `json:"enabled"`
	Priority    int      `json:"priority"`
	Source      string   `json:"source"`
	Values      []string `json:"values"`
	Host        string   `json:"host"`
	Path        string   `json:"path_prefix"`
	Method      string   `json:"method"`
	Schedule    string   `json:"schedule"`
	ExpiresAt   int64    `json:"expires_at"`
	Log         bool     `json:"log"`
	Reputation  bool     `json:"reputation"`
	Alert       bool     `json:"alert"`
}

// AccessGroupDocument defines the transport schema for an access IP group document payload.
type AccessGroupDocument struct {
	Name     string   `json:"name"`
	Networks []string `json:"networks"`
}

// AccessDatasetNetwork defines a CIDR network mapping within an access dataset.
type AccessDatasetNetwork struct {
	CIDR    string `json:"cidr"`
	Country string `json:"country"`
	ASN     string `json:"asn"`
}

// AccessDatasetDocument defines the transport schema for an access dataset document payload.
type AccessDatasetDocument struct {
	Name     string                 `json:"name"`
	Networks []AccessDatasetNetwork `json:"networks"`
}
