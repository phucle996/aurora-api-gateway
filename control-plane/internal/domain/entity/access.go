package entity

import "encoding/json"

// AccessChangeCommand represents an administrative request to mutate access objects (rules, groups, datasets).
type AccessChangeCommand struct {
	ID              int64
	Kind            string
	ExpectedVersion int64
	ExpectedRelease int64
	Delete          bool
	Document        json.RawMessage
	Actor           string
	Key             string
}

// AccessChangeResult returns the updated object ID, version and new compiled release ID.
type AccessChangeResult struct {
	ID        int64
	Version   int64
	ReleaseID int64
}

// AccessReadQuery queries active or historical access objects.
type AccessReadQuery struct {
	ID      int64
	History bool
}

// AccessReadItem represents an immutable version of an access object.
type AccessReadItem struct {
	ID        int64
	Kind      string
	Version   int64
	Document  json.RawMessage
	Deleted   bool
	UpdatedAt string
	Actor     string
}

// AccessStatusNode represents an edge node's current release synchronization phase.
type AccessStatusNode struct {
	ID        string
	ReleaseID int64
	Phase     string
	Message   string
	UpdatedAt string
}

// AccessStatusResult aggregates the active release ID and all edge nodes' sync states.
type AccessStatusResult struct {
	ReleaseID int64
	Nodes     []AccessStatusNode
}

// AccessSyncQuery is used by edge nodes to pull desired access snapshot.
type AccessSyncQuery struct {
	NodeID string
}

// AccessSyncResult returns the active compiled snapshot and cryptographic digest.
type AccessSyncResult struct {
	ReleaseID int64
	Digest    string
	Payload   json.RawMessage
}

// AccessReportCommand reports node deployment status transition.
type AccessReportCommand struct {
	NodeID    string
	ReleaseID int64
	Phase     string
	Message   string
}

// AccessMatchCommand reports sampled rule matches observed on an edge node.
type AccessMatchCommand struct {
	NodeID    string
	Key       string
	ReleaseID int64
	RuleID    int64
	IP        string
}

// AccessActivityItem represents an access decision event with calculated reputation risk score.
type AccessActivityItem struct {
	RiskScore  int
	NodeID     string
	RuleID     int64
	ReleaseID  int64
	IP         string
	Action     string
	Reputation bool
	Alert      bool
	CreatedAt  string
}

// AccessCatalogCountry provides available country codes and mapped CIDR counts from imported datasets.
type AccessCatalogCountry struct {
	Code      string
	CIDRCount int
}

// AccessCatalogASN provides available Autonomous System Numbers and mapped CIDR counts.
type AccessCatalogASN struct {
	ASN       string
	CIDRCount int
}

// AccessCatalog provides real cluster metadata for IP & Access rule configuration.
type AccessCatalog struct {
	Hosts     []string
	Countries []AccessCatalogCountry
	ASNs      []AccessCatalogASN
}
