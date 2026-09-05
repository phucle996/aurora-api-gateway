package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

type PolicyRepository struct{ writer, reader *sql.DB }

func NewPolicyRepository(writer, reader *sql.DB) *PolicyRepository {
	return &PolicyRepository{writer, reader}
}

// Storage-only immutable snapshot. Not an API workflow entity or authority port.
type policySnapshot struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Host        string               `json:"host"`
	PathPrefix  string               `json:"path_prefix"`
	Mode        string               `json:"mode"`
	Priority    int                  `json:"priority"`
	RuleIDs     []int64              `json:"rule_ids"`
	Rules       []policySnapshotRule `json:"rules"`
}
type policySnapshotRule struct {
	ID           int64  `json:"id"`
	Version      int64  `json:"version"`
	Name         string `json:"name"`
	Group        string `json:"group"`
	Path         string `json:"path"`
	Action       string `json:"action"`
	Score        int    `json:"score"`
	Priority     int    `json:"priority"`
	Enabled      bool   `json:"enabled"`
	RuntimeReady bool   `json:"runtime_ready"`
}

func (r *PolicyRepository) SavePolicy(ctx context.Context, c entity.SavePolicyCommand) (entity.SavePolicyResult, error) {
	var out entity.SavePolicyResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	input, _ := json.Marshal(c)
	hash := fmt.Sprintf("%x", sha256.Sum256(append([]byte(fmt.Sprint(c.ID)), input...)))
	var oldHash, result string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result FROM policy_receipts WHERE actor=? AND request_key=?`, c.Actor, c.RequestKey).Scan(&oldHash, &result)
	if err == nil {
		if oldHash != hash {
			return out, taxonomy.ErrPolicyConflict
		}
		err = json.Unmarshal([]byte(result), &out)
		return out, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	var version int64
	if c.ID != 0 {
		err = tx.QueryRowContext(ctx, `SELECT version FROM policies WHERE id=?`, c.ID).Scan(&version)
		if errors.Is(err, sql.ErrNoRows) {
			return out, taxonomy.ErrPolicyNotFound
		}
		if err != nil {
			return out, err
		}
		if version != c.ExpectedVersion {
			return out, taxonomy.ErrPolicyConflict
		}
	} else {
		var count int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM policies`).Scan(&count); err != nil {
			return out, err
		}
		if count >= 64 {
			return out, taxonomy.ErrPolicyInvalid
		}
	}
	var doc []byte
	operation := "save"
	if c.RestoreVersion > 0 {
		operation = "restore"
		err = tx.QueryRowContext(ctx, `SELECT document FROM policy_revisions WHERE policy_id=? AND version=?`, c.ID, c.RestoreVersion).Scan(&doc)
		if errors.Is(err, sql.ErrNoRows) {
			return out, taxonomy.ErrPolicyNotFound
		}
		if err != nil {
			return out, err
		}
	} else {
		snapshot := policySnapshot{Name: c.Name, Description: c.Description, Host: c.Host, PathPrefix: c.PathPrefix, Mode: c.Mode, Priority: c.Priority, RuleIDs: c.RuleIDs, Rules: []policySnapshotRule{}}
		ids, _ := json.Marshal(c.RuleIDs)
		rows, e := tx.QueryContext(ctx, `WITH selected AS (SELECT CAST(value AS INTEGER) id FROM json_each(?))
   SELECT r.id,r.version,r.name,r.rule_group,r.path,r.action,r.score,r.priority,r.enabled,coalesce(d.runtime_ready,1)
   FROM selected s JOIN rules r ON r.id=s.id LEFT JOIN rule_definitions d ON d.rule_id=r.id AND d.version=r.version ORDER BY r.id`, string(ids))
		if e != nil {
			return out, e
		}
		for rows.Next() {
			var item policySnapshotRule
			if e = rows.Scan(&item.ID, &item.Version, &item.Name, &item.Group, &item.Path, &item.Action, &item.Score, &item.Priority, &item.Enabled, &item.RuntimeReady); e != nil {
				rows.Close()
				return out, e
			}
			snapshot.Rules = append(snapshot.Rules, item)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return out, e
		}
		if len(snapshot.Rules) != len(c.RuleIDs) {
			return out, taxonomy.ErrPolicyInvalid
		}
		doc, err = json.Marshal(snapshot)
		if err != nil {
			return out, err
		}
	}
	if c.ID == 0 {
		res, e := tx.ExecContext(ctx, `INSERT INTO policies(version,document) VALUES(1,?)`, string(doc))
		if e != nil {
			return out, e
		}
		c.ID, err = res.LastInsertId()
		if err != nil {
			return out, err
		}
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE policies SET version=version+1,document=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?`, string(doc), c.ID, c.ExpectedVersion)
		if err != nil {
			return out, err
		}
	}
	out = entity.SavePolicyResult{ID: c.ID, Version: version + 1}
	_, err = tx.ExecContext(ctx, `INSERT INTO policy_revisions(policy_id,version,document,actor,operation) VALUES(?,?,?,?,?)`, out.ID, out.Version, string(doc), c.Actor, operation)
	if err != nil {
		return out, err
	}
	receipt, _ := json.Marshal(out)
	_, err = tx.ExecContext(ctx, `INSERT INTO policy_receipts VALUES(?,?,?,?)`, c.Actor, c.RequestKey, hash, string(receipt))
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (r *PolicyRepository) ReadPolicies(ctx context.Context, q entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error) {
	out := []entity.ReadPoliciesItem{}
	query := `SELECT id,version,published_version,document,created_at,updated_at,'','',status FROM policies WHERE (?=0 OR id=?) ORDER BY id DESC LIMIT 64`
	if q.History {
		query = `SELECT policy_id,version,NULL,document,created_at,created_at,actor,operation,'Revision' FROM policy_revisions WHERE policy_id=? AND policy_id=? ORDER BY version DESC LIMIT 100`
	}
	rows, err := r.reader.QueryContext(ctx, query, q.ID, q.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p entity.ReadPoliciesItem
		var doc string
		if err = rows.Scan(&p.ID, &p.Version, &p.PublishedVersion, &doc, &p.CreatedAt, &p.UpdatedAt, &p.Actor, &p.Operation, &p.Status); err != nil {
			return nil, err
		}
		p.Document = json.RawMessage(doc)
		out = append(out, p)
	}
	return out, rows.Err()
}
func (r *PolicyRepository) PolicyCatalog(ctx context.Context) ([]entity.PolicyCatalogRule, error) {
	out := []entity.PolicyCatalogRule{}
	rows, err := r.reader.QueryContext(ctx, `SELECT r.id,r.version,r.name,r.rule_group,r.action,r.enabled,coalesce(d.runtime_ready,1) FROM rules r LEFT JOIN rule_definitions d ON d.rule_id=r.id AND d.version=r.version ORDER BY r.id LIMIT 1024`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p entity.PolicyCatalogRule
		if err = rows.Scan(&p.ID, &p.Version, &p.Name, &p.Group, &p.Action, &p.Enabled, &p.RuntimeReady); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PolicyRepository) PublishPolicy(ctx context.Context, c entity.PublishPolicyCommand, compile func(context.Context, []byte) error) (entity.PublishPolicyResult, error) {
	var out entity.PublishPolicyResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	input, _ := json.Marshal(c)
	hash := fmt.Sprintf("publish:%x", sha256.Sum256(append([]byte(fmt.Sprint(c.ID)), input...)))
	if !c.Preview {
		var h, result string
		e := tx.QueryRowContext(ctx, `SELECT request_hash,result FROM policy_receipts WHERE actor=? AND request_key=?`, c.Actor, c.RequestKey).Scan(&h, &result)
		if e == nil {
			if h != hash {
				return out, taxonomy.ErrPolicyConflict
			}
			e = json.Unmarshal([]byte(result), &out)
			return out, e
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return out, e
		}
	}
	var head, version int64
	err = tx.QueryRowContext(ctx, `SELECT coalesce((SELECT release_id FROM policy_cluster_head WHERE singleton=1),0)`).Scan(&head)
	if err != nil {
		return out, err
	}
	if head != c.ExpectedRelease {
		return out, taxonomy.ErrPolicyConflict
	}
	err = tx.QueryRowContext(ctx, `SELECT version FROM policies WHERE id=?`, c.ID).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrPolicyNotFound
	}
	if err != nil {
		return out, err
	}
	if version != c.ExpectedVersion {
		return out, taxonomy.ErrPolicyConflict
	}
	// Read publication authority directly, never list/detail or current mutable rules.
	rows, err := tx.QueryContext(ctx, `WITH selected AS (
  SELECT id,CASE WHEN id=? THEN version ELSE published_version END v FROM policies
  WHERE (id=? AND ?=0) OR (id<>? AND published_version IS NOT NULL))
  SELECT s.id,s.v,r.document FROM selected s JOIN policy_revisions r ON r.policy_id=s.id AND r.version=s.v ORDER BY s.id`, c.ID, c.ID, c.Disable, c.ID)
	if err != nil {
		return out, err
	}
	type runtimeRule struct {
		ID       int64  `json:"id"`
		Path     string `json:"path"`
		Action   string `json:"action"`
		Score    int    `json:"score"`
		Priority int    `json:"priority"`
	}
	type runtimePolicy struct {
		ID         int64         `json:"id"`
		Host       string        `json:"host"`
		PathPrefix string        `json:"path_prefix"`
		Priority   int           `json:"priority"`
		Rules      []runtimeRule `json:"rules"`
	}
	members := []struct {
		ID      int64  `json:"id"`
		Version int64  `json:"version"`
		Name    string `json:"name"`
	}{}
	policies := []runtimePolicy{}
	for rows.Next() {
		var id, v int64
		var raw string
		if err = rows.Scan(&id, &v, &raw); err != nil {
			rows.Close()
			return out, err
		}
		var snap policySnapshot
		if err = json.Unmarshal([]byte(raw), &snap); err != nil {
			rows.Close()
			return out, err
		}
		p := runtimePolicy{ID: id, Host: snap.Host, PathPrefix: snap.PathPrefix, Priority: snap.Priority, Rules: []runtimeRule{}}
		for _, rule := range snap.Rules {
			if !rule.Enabled || !rule.RuntimeReady {
				rows.Close()
				return out, taxonomy.ErrPolicyUnsupported
			}
			action := rule.Action
			if snap.Mode == "detect" {
				action = "log"
			}
			if snap.Mode == "block" && action != "allow" {
				action = "block"
			}
			p.Rules = append(p.Rules, runtimeRule{rule.ID, rule.Path, action, rule.Score, rule.Priority})
		}
		policies = append(policies, p)
		members = append(members, struct {
			ID      int64  `json:"id"`
			Version int64  `json:"version"`
			Name    string `json:"name"`
		}{id, v, snap.Name})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	sort.Slice(policies, func(i, j int) bool {
		if policies[i].Priority == policies[j].Priority {
			return policies[i].ID < policies[j].ID
		}
		return policies[i].Priority < policies[j].Priority
	})
	var next int64
	err = tx.QueryRowContext(ctx, `SELECT seq+1 FROM sqlite_sequence WHERE name='policy_cluster_releases'`).Scan(&next)
	if err != nil {
		return out, err
	}
	payload, err := json.Marshal(struct {
		Schema     int             `json:"schema_version"`
		Generation int64           `json:"generation"`
		Policies   []runtimePolicy `json:"policies"`
	}{3, next, policies})
	if err != nil {
		return out, err
	}
	if err = compile(ctx, payload); err != nil {
		return out, err
	}
	sum := sha256.Sum256(payload)
	membership, _ := json.Marshal(members)
	out = entity.PublishPolicyResult{ReleaseID: next, Digest: hex.EncodeToString(sum[:]), Payload: payload, Membership: membership, Preview: c.Preview}
	if c.Preview {
		return out, nil
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO policy_cluster_releases(id,payload,digest,membership,actor) VALUES(?,?,?,?,?)`, next, payload, out.Digest, string(membership), c.Actor)
	if err != nil {
		return out, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO policy_cluster_head VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET release_id=excluded.release_id`, next)
	if err != nil {
		return out, err
	}
	var published any = version
	if c.Disable {
		published = nil
	}
	_, err = tx.ExecContext(ctx, `UPDATE policies SET published_version=?,status=CASE WHEN ? THEN 'Disabled' ELSE 'Published' END WHERE id=?`, published, c.Disable, c.ID)
	if err != nil {
		return out, err
	}
	receipt, _ := json.Marshal(out)
	_, err = tx.ExecContext(ctx, `INSERT INTO policy_receipts VALUES(?,?,?,?)`, c.Actor, c.RequestKey, hash, string(receipt))
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (r *PolicyRepository) PolicyCluster(ctx context.Context) (entity.PolicyClusterStatus, error) {
	out := entity.PolicyClusterStatus{Nodes: []entity.PolicyClusterNode{}}
	rows, err := r.reader.QueryContext(ctx, `WITH head AS (SELECT coalesce((SELECT release_id FROM policy_cluster_head WHERE singleton=1),0) id)
 SELECT head.id,coalesce(n.id,''),coalesce(p.release_id,0),
 CASE WHEN p.release_id=head.id THEN CASE WHEN p.phase='observed' AND unixepoch('now')-unixepoch(p.updated_at)>45 THEN 'stale' ELSE p.phase END ELSE 'pending' END,coalesce(p.message,''),coalesce(p.updated_at,'')
 FROM head LEFT JOIN cluster_nodes n ON 1=1 LEFT JOIN policy_node_reports p ON p.node_id=n.id ORDER BY n.id`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var n entity.PolicyClusterNode
		if err = rows.Scan(&out.ReleaseID, &n.ID, &n.ReleaseID, &n.Phase, &n.Message, &n.UpdatedAt); err != nil {
			return out, err
		}
		if n.ID != "" {
			out.Nodes = append(out.Nodes, n)
		}
	}
	return out, rows.Err()
}
func (r *PolicyRepository) PolicySync(ctx context.Context, q entity.PolicySyncQuery) (entity.PolicySyncResult, error) {
	var out entity.PolicySyncResult
	var payload []byte
	err := r.reader.QueryRowContext(ctx, `SELECT coalesce(r.id,0),coalesce(r.digest,''),coalesce(r.payload,'null') FROM cluster_nodes n LEFT JOIN policy_cluster_head h ON h.singleton=1 LEFT JOIN policy_cluster_releases r ON r.id=h.release_id WHERE n.id=?`, q.NodeID).Scan(&out.ReleaseID, &out.Digest, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrPolicyNotFound
	}
	out.Payload = payload
	return out, err
}
func (r *PolicyRepository) PolicyReport(ctx context.Context, c entity.PolicyReportCommand) error {
	res, err := r.writer.ExecContext(ctx, `INSERT INTO policy_node_reports(node_id,release_id,phase,message)
 SELECT n.id,h.release_id,?,? FROM cluster_nodes n JOIN policy_cluster_head h ON h.release_id=? WHERE n.id=?
 ON CONFLICT(node_id) DO UPDATE SET release_id=excluded.release_id,phase=excluded.phase,message=excluded.message,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE policy_node_reports.release_id<excluded.release_id OR policy_node_reports.phase=excluded.phase OR policy_node_reports.phase='failed'
 OR (policy_node_reports.phase='validated' AND excluded.phase IN ('reload_requested','observed','failed'))
 OR (policy_node_reports.phase='reload_requested' AND excluded.phase IN ('observed','failed'))`, c.Phase, c.Message, c.ReleaseID, c.NodeID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return taxonomy.ErrPolicyConflict
	}
	return nil
}
