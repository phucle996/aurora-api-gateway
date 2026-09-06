package entity

import "encoding/json"

// Draft mutations capture rule revisions, never references to mutable live rules.
type SavePolicyCommand struct {
	ID              int64   `json:"-"`
	ExpectedVersion int64   `json:"expected_version"`
	RestoreVersion  int64   `json:"restore_version,omitempty"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Host            string  `json:"host"`
	PathPrefix      string  `json:"path_prefix"`
	Mode            string  `json:"mode"`
	Priority        int     `json:"priority"`
	RuleIDs         []int64 `json:"rule_ids"`
	Actor           string  `json:"-"`
	RequestKey      string  `json:"-"`
}
type SavePolicyResult struct {
	ID      int64 `json:"id"`
	Version int64 `json:"version"`
}
type ReadPoliciesQuery struct {
	ID      int64
	History bool
}
type ReadPoliciesItem struct {
	Status           string          `json:"status"`
	ID               int64           `json:"id"`
	Version          int64           `json:"version"`
	PublishedVersion *int64          `json:"published_version"`
	Document         json.RawMessage `json:"document"`
	CreatedAt        string          `json:"created_at"`
	UpdatedAt        string          `json:"updated_at"`
	Actor            string          `json:"actor,omitempty"`
	Operation        string          `json:"operation,omitempty"`
}
type PolicyCatalogItem struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}
type PolicyCatalogRule struct {
	ID           int64  `json:"id"`
	Version      int64  `json:"version"`
	Name         string `json:"name"`
	Group        string `json:"group"`
	Action       string `json:"action"`
	Enabled      bool   `json:"enabled"`
	RuntimeReady bool   `json:"runtime_ready"`
}
type PublishPolicyCommand struct {
	ID              int64  `json:"-"`
	ExpectedVersion int64  `json:"expected_version"`
	ExpectedRelease int64  `json:"expected_release"`
	Disable         bool   `json:"disable"`
	Preview         bool   `json:"-"`
	Actor           string `json:"-"`
	RequestKey      string `json:"-"`
}
type PublishPolicyResult struct {
	ReleaseID  int64           `json:"release_id"`
	Digest     string          `json:"digest"`
	Payload    json.RawMessage `json:"payload"`
	Membership json.RawMessage `json:"membership"`
	Preview    bool            `json:"preview"`
}
type PolicyClusterStatus struct {
	ReleaseID int64               `json:"release_id"`
	Nodes     []PolicyClusterNode `json:"nodes"`
}
type PolicyClusterNode struct {
	ID        string `json:"id"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
}
type PolicySyncQuery struct{ NodeID string }
type PolicySyncResult struct {
	ReleaseID int64           `json:"release_id"`
	Digest    string          `json:"digest"`
	Payload   json.RawMessage `json:"payload"`
}
type PolicyReportCommand struct {
	NodeID    string `json:"-"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
}
