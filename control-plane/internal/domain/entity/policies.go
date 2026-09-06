package entity

import "encoding/json"

// Draft mutations capture rule revisions, never references to mutable live rules.
type SavePolicyCommand struct {
	ID              int64
	ExpectedVersion int64
	RestoreVersion  int64
	Name            string
	Description     string
	Host            string
	PathPrefix      string
	Mode            string
	Priority        int
	RuleIDs         []int64
	Actor           string
	RequestKey      string
}

type SavePolicyResult struct {
	ID      int64
	Version int64
}

type ReadPoliciesQuery struct {
	ID      int64
	History bool
}

type ReadPoliciesItem struct {
	Status           string
	ID               int64
	Version          int64
	PublishedVersion *int64
	Document         json.RawMessage
	CreatedAt        string
	UpdatedAt        string
	Actor            string
	Operation        string
}

type PolicyCatalogItem struct {
	ID   int64
	Name string
}

type PolicyCatalogRule struct {
	ID           int64
	Version      int64
	Name         string
	Group        string
	Action       string
	Enabled      bool
	RuntimeReady bool
}

type PublishPolicyCommand struct {
	ID              int64
	ExpectedVersion int64
	ExpectedRelease int64
	Disable         bool
	Preview         bool
	Actor           string
	RequestKey      string
}

type PublishPolicyResult struct {
	ReleaseID  int64
	Digest     string
	Payload    json.RawMessage
	Membership json.RawMessage
	Preview    bool
}

type PolicyClusterStatus struct {
	ReleaseID int64
	Nodes     []PolicyClusterNode
}

type PolicyClusterNode struct {
	ID        string
	ReleaseID int64
	Phase     string
	Message   string
	UpdatedAt string
}

type PolicySyncQuery struct{ NodeID string }

type PolicySyncResult struct {
	ReleaseID int64
	Digest    string
	Payload   json.RawMessage
}

type PolicyReportCommand struct {
	NodeID    string
	ReleaseID int64
	Phase     string
	Message   string
}

