// Package access owns access configuration publication, reads, node settlement
// and sampled match ingestion. It never reads a Policies API projection.
package access

import (
	"context"
	"encoding/json"
	"errors"
)

var ErrInvalid = errors.New("invalid access configuration")
var ErrConflict = errors.New("access configuration changed; refresh before retrying")
var ErrMissing = errors.New("access resource not found")
var ErrCompiler = errors.New("access compiler rejected snapshot or is unavailable")

type ChangeCommand struct {
	ID              int64           `json:"id"`
	Kind            string          `json:"kind"`
	ExpectedVersion int64           `json:"expected_version"`
	ExpectedRelease int64           `json:"expected_release"`
	Delete          bool            `json:"delete"`
	Document        json.RawMessage `json:"document"`
	Actor           string          `json:"-"`
	Key             string          `json:"-"`
}
type ChangeResult struct {
	ID        int64 `json:"id"`
	Version   int64 `json:"version"`
	ReleaseID int64 `json:"release_id"`
}
type ChangeRepository interface {
	Change(context.Context, ChangeCommand, func(context.Context, []byte) error) (ChangeResult, error)
}
type ChangePort interface {
	Change(context.Context, ChangeCommand) (ChangeResult, error)
}

type ReadQuery struct {
	ID      int64
	History bool
}
type ReadItem struct {
	ID        int64           `json:"id"`
	Kind      string          `json:"kind"`
	Version   int64           `json:"version"`
	Document  json.RawMessage `json:"document"`
	Deleted   bool            `json:"deleted"`
	UpdatedAt string          `json:"updated_at"`
	Actor     string          `json:"actor"`
}
type ReadPort interface {
	Read(context.Context, ReadQuery) ([]ReadItem, error)
}
type StatusNode struct {
	ID        string `json:"id"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
}
type StatusResult struct {
	ReleaseID int64        `json:"release_id"`
	Nodes     []StatusNode `json:"nodes"`
}
type StatusPort interface {
	Status(context.Context) (StatusResult, error)
}
type SyncQuery struct{ NodeID string }
type SyncResult struct {
	ReleaseID int64           `json:"release_id"`
	Digest    string          `json:"digest"`
	Payload   json.RawMessage `json:"payload"`
}
type SyncPort interface {
	Desired(context.Context, SyncQuery) (SyncResult, error)
}
type ReportCommand struct {
	NodeID    string `json:"-"`
	ReleaseID int64  `json:"release_id"`
	Phase     string `json:"phase"`
	Message   string `json:"message"`
}
type ReportPort interface {
	Report(context.Context, ReportCommand) error
}
type MatchCommand struct {
	NodeID    string `json:"-"`
	Key       string `json:"key"`
	ReleaseID int64  `json:"release_id"`
	RuleID    int64  `json:"rule_id"`
	IP        string `json:"ip"`
}
type MatchPort interface {
	Match(context.Context, MatchCommand) error
}
type ActivityItem struct {
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
type ActivityPort interface {
	Activity(context.Context) ([]ActivityItem, error)
}

// Publication-owned input documents. These are not read/detail authorities.
type ruleInput struct {
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
type groupInput struct {
	Name     string   `json:"name"`
	Networks []string `json:"networks"`
}
type datasetNetwork struct {
	CIDR    string `json:"cidr"`
	Country string `json:"country"`
	ASN     string `json:"asn"`
}
type datasetInput struct {
	Name     string           `json:"name"`
	Networks []datasetNetwork `json:"networks"`
}
type runtimeRule struct {
	ID         int64    `json:"id"`
	Priority   int      `json:"priority"`
	Action     string   `json:"action"`
	Networks   []string `json:"networks"`
	Host       string   `json:"host"`
	Path       string   `json:"path_prefix"`
	Method     string   `json:"method"`
	Schedule   string   `json:"schedule"`
	ExpiresAt  int64    `json:"expires_at"`
	Log        bool     `json:"log"`
	Reputation bool     `json:"reputation"`
	Alert      bool     `json:"alert"`
}
