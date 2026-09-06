package dto

import "encoding/json"

// SavePolicyRequest represents the HTTP request payload for creating or updating a policy draft.
type SavePolicyRequest struct {
	ExpectedVersion int64   `json:"expected_version"`
	RestoreVersion  int64   `json:"restore_version,omitempty"`
	Name            string  `json:"name"`
	Description     string  `json:"description"`
	Host            string  `json:"host"`
	PathPrefix      string  `json:"path_prefix,omitempty"`
	Mode            string  `json:"mode"`
	Priority        int     `json:"priority"`
	RuleIDs         []int64 `json:"rule_ids"`
}

// SavePolicyResponse represents the HTTP response payload for draft policy mutations.
type SavePolicyResponse struct {
	ID      int64 `json:"id"`
	Version int64 `json:"version"`
}

// ReadPolicyItemResponse represents the HTTP response for reading a policy draft or history record.
type ReadPolicyItemResponse struct {
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

// PolicyCatalogItemResponse represents a lightweight policy descriptor for catalogs.
type PolicyCatalogItemResponse struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// PolicyCatalogRuleResponse represents a rule definition available for policy attachment.
type PolicyCatalogRuleResponse struct {
	ID           int64  `json:"id"`
	Version      int64  `json:"version"`
	Name         string `json:"name"`
	Group        string `json:"group"`
	Action       string `json:"action"`
	Enabled      bool   `json:"enabled"`
	RuntimeReady bool   `json:"runtime_ready"`
}

// PublishPolicyRequest represents the HTTP request payload for publishing or disabling a policy release.
type PublishPolicyRequest struct {
	ExpectedVersion int64 `json:"expected_version"`
	ExpectedRelease int64 `json:"expected_release"`
	Disable         bool  `json:"disable"`
}

// PublishPolicyResponse represents the HTTP response payload for a policy publication.
type PublishPolicyResponse struct {
	ReleaseID  int64           `json:"release_id"`
	Digest     string          `json:"digest"`
	Payload    json.RawMessage `json:"payload"`
	Membership json.RawMessage `json:"membership"`
	Preview    bool            `json:"preview"`
}

// PolicyClusterNodeResponse represents an edge node sync status in a cluster.
type PolicyClusterNodeResponse struct {
	ID        string `json:"id"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
}

// PolicyClusterStatusResponse represents the overall cluster sync status across all edge nodes.
type PolicyClusterStatusResponse struct {
	ReleaseID int64                       `json:"release_id"`
	Nodes     []PolicyClusterNodeResponse `json:"nodes"`
}

// PolicySyncResponse represents the desired policy release payload and cryptographic digest for a node.
type PolicySyncResponse struct {
	ReleaseID int64           `json:"release_id"`
	Digest    string          `json:"digest"`
	Payload   json.RawMessage `json:"payload"`
}

// PolicyReportRequest represents the HTTP request payload for node release status reports.
type PolicyReportRequest struct {
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
}
