package access

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"sort"
)

type Repository struct{ Writer, Reader *sql.DB }

func (r Repository) Change(ctx context.Context, c ChangeCommand, compile func(context.Context, []byte) error) (ChangeResult, error) {
	var out ChangeResult
	tx, e := r.Writer.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	input, _ := json.Marshal(c)
	hash := fmt.Sprintf("%x", sha256.Sum256(input))
	var oldHash, receipt string
	e = tx.QueryRowContext(ctx, `SELECT request_hash,result FROM access_receipts WHERE actor=? AND request_key=?`, c.Actor, c.Key).Scan(&oldHash, &receipt)
	if e == nil {
		if hash != oldHash {
			return out, ErrConflict
		}
		e = json.Unmarshal([]byte(receipt), &out)
		return out, e
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return out, e
	}
	var head, version int64
	var kind string
	var deleted bool
	if e = tx.QueryRowContext(ctx, `SELECT coalesce((SELECT release_id FROM access_head WHERE singleton=1),0)`).Scan(&head); e != nil {
		return out, e
	}
	if head != c.ExpectedRelease {
		return out, ErrConflict
	}
	if c.ID > 0 {
		e = tx.QueryRowContext(ctx, `SELECT kind,version,deleted FROM access_objects WHERE id=?`, c.ID).Scan(&kind, &version, &deleted)
		if errors.Is(e, sql.ErrNoRows) {
			return out, ErrMissing
		}
		if e != nil {
			return out, e
		}
		if deleted || kind != c.Kind || version != c.ExpectedVersion {
			return out, ErrConflict
		}
	}
	if c.ID == 0 {
		var count int
		if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM access_objects WHERE deleted=0`).Scan(&count); e != nil {
			return out, e
		}
		if count >= 512 {
			return out, ErrInvalid
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO access_objects(kind,version,document) VALUES(?,1,?)`, c.Kind, string(c.Document))
		if err != nil {
			return out, err
		}
		c.ID, e = res.LastInsertId()
		if e != nil {
			return out, e
		}
	} else {
		if c.Delete {
			_, e = tx.ExecContext(ctx, `UPDATE access_objects SET version=version+1,deleted=1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, c.ID)
		} else {
			_, e = tx.ExecContext(ctx, `UPDATE access_objects SET version=version+1,document=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, string(c.Document), c.ID)
		}
		if e != nil {
			return out, e
		}
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO access_revisions(object_id,version,kind,document,deleted,actor) SELECT id,version,kind,document,deleted,? FROM access_objects WHERE id=?`, c.Actor, c.ID)
	if e != nil {
		return out, e
	}
	// Publication authority is read within this transaction. Groups and imported
	// networks are materialized into this immutable release, never live references.
	rows, e := tx.QueryContext(ctx, `WITH active AS (SELECT id,kind,document FROM access_objects WHERE deleted=0) SELECT id,kind,document FROM active ORDER BY id`)
	if e != nil {
		return out, e
	}
	type authority struct {
		id   int64
		rule ruleInput
	}
	rules := []authority{}
	groups := map[string][]string{}
	countries := map[string][]string{}
	asns := map[string][]string{}
	for rows.Next() {
		var id int64
		var k, raw string
		if e = rows.Scan(&id, &k, &raw); e != nil {
			break
		}
		switch k {
		case "rule":
			var v ruleInput
			e = json.Unmarshal([]byte(raw), &v)
			rules = append(rules, authority{id, v})
		case "group":
			var v groupInput
			e = json.Unmarshal([]byte(raw), &v)
			groups[fmt.Sprint(id)] = v.Networks
		case "dataset":
			var v datasetInput
			e = json.Unmarshal([]byte(raw), &v)
			for _, n := range v.Networks {
				if n.Country != "" {
					countries[n.Country] = append(countries[n.Country], n.CIDR)
				}
				if n.ASN != "" {
					asns[n.ASN] = append(asns[n.ASN], n.CIDR)
				}
			}
		}
		if e != nil {
			break
		}
	}
	rowErr := rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	if rowErr != nil {
		return out, rowErr
	}
	runtime := []runtimeRule{}
	for _, a := range rules {
		v := a.rule
		if !v.Enabled {
			continue
		}
		networks := []string{}
		for _, value := range v.Values {
			var found []string
			switch v.Source {
			case "ip", "cidr":
				found = []string{value}
			case "country":
				found = countries[value]
			case "asn":
				found = asns[value]
			case "group":
				found = groups[value]
			}
			if len(found) == 0 {
				return out, fmt.Errorf("%w: rule %s has an unresolved %s source; import networks or disable the rule", ErrInvalid, v.Name, v.Source)
			}
			networks = append(networks, found...)
		}
		sort.Strings(networks)
		unique := networks[:0]
		for _, n := range networks {
			if len(unique) == 0 || unique[len(unique)-1] != n {
				unique = append(unique, n)
			}
		}
		runtime = append(runtime, runtimeRule{a.id, v.Priority, v.Action, unique, v.Host, v.Path, v.Method, v.Schedule, v.ExpiresAt, v.Log, v.Reputation, v.Alert})
	}
	sort.Slice(runtime, func(i, j int) bool {
		if runtime[i].Priority == runtime[j].Priority {
			return runtime[i].ID < runtime[j].ID
		}
		return runtime[i].Priority < runtime[j].Priority
	})
	next := head + 1
	payload, e := json.Marshal(struct {
		Schema     int           `json:"schema_version"`
		Generation int64         `json:"generation"`
		Rules      []runtimeRule `json:"rules"`
	}{1, next, runtime})
	if e != nil {
		return out, e
	}
	if e = compile(ctx, payload); e != nil {
		return out, e
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	_, e = tx.ExecContext(ctx, `INSERT INTO access_releases(id,payload,digest,actor) VALUES(?,?,?,?)`, next, payload, digest, c.Actor)
	if e != nil {
		return out, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO access_head VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET release_id=excluded.release_id`, next)
	if e != nil {
		return out, e
	}
	out = ChangeResult{c.ID, version + 1, next}
	b, _ := json.Marshal(out)
	_, e = tx.ExecContext(ctx, `INSERT INTO access_receipts VALUES(?,?,?,?)`, c.Actor, c.Key, hash, string(b))
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (r Repository) Read(ctx context.Context, q ReadQuery) ([]ReadItem, error) {
	query := `SELECT id,kind,version,document,deleted,updated_at,'' FROM access_objects WHERE deleted=0 AND (?=0 OR id=?) ORDER BY id DESC LIMIT 512`
	if q.History {
		query = `SELECT object_id,kind,version,document,deleted,created_at,actor FROM access_revisions WHERE object_id=? AND object_id=? ORDER BY version DESC LIMIT 100`
	}
	rows, e := r.Reader.QueryContext(ctx, query, q.ID, q.ID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []ReadItem{}
	for rows.Next() {
		var v ReadItem
		var raw string
		if e = rows.Scan(&v.ID, &v.Kind, &v.Version, &raw, &v.Deleted, &v.UpdatedAt, &v.Actor); e != nil {
			return nil, e
		}
		v.Document = json.RawMessage(raw)
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r Repository) Status(ctx context.Context) (StatusResult, error) {
	out := StatusResult{Nodes: []StatusNode{}}
	rows, e := r.Reader.QueryContext(ctx, `WITH head AS (SELECT coalesce((SELECT release_id FROM access_head WHERE singleton=1),0) id)
 SELECT head.id,coalesce(n.id,''),coalesce(p.release_id,0),CASE WHEN p.release_id=head.id THEN CASE WHEN unixepoch('now')-unixepoch(p.updated_at)>45 THEN 'stale' ELSE p.phase END ELSE 'pending' END,coalesce(p.message,''),coalesce(p.updated_at,'') FROM head LEFT JOIN cluster_nodes n ON 1=1 LEFT JOIN access_reports p ON p.node_id=n.id ORDER BY n.id`)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var n StatusNode
		if e = rows.Scan(&out.ReleaseID, &n.ID, &n.ReleaseID, &n.Phase, &n.Message, &n.UpdatedAt); e != nil {
			return out, e
		}
		if n.ID != "" {
			out.Nodes = append(out.Nodes, n)
		}
	}
	return out, rows.Err()
}
func (r Repository) Desired(ctx context.Context, q SyncQuery) (SyncResult, error) {
	var out SyncResult
	var b []byte
	e := r.Reader.QueryRowContext(ctx, `SELECT coalesce(r.id,0),coalesce(r.digest,''),coalesce(r.payload,'null') FROM cluster_nodes n LEFT JOIN access_head h ON h.singleton=1 LEFT JOIN access_releases r ON r.id=h.release_id WHERE n.id=?`, q.NodeID).Scan(&out.ReleaseID, &out.Digest, &b)
	if errors.Is(e, sql.ErrNoRows) {
		return out, ErrMissing
	}
	out.Payload = b
	return out, e
}
func (r Repository) Report(ctx context.Context, c ReportCommand) error {
	if c.ReleaseID < 1 || len(c.Message) > 512 {
		return ErrInvalid
	}
	switch c.Phase {
	case "validated", "reload_requested", "observed", "failed":
	default:
		return ErrInvalid
	}
	res, e := r.Writer.ExecContext(ctx, `INSERT INTO access_reports(node_id,release_id,phase,message) SELECT n.id,h.release_id,?,? FROM cluster_nodes n JOIN access_head h ON h.release_id=? WHERE n.id=?
 ON CONFLICT(node_id) DO UPDATE SET release_id=excluded.release_id,phase=excluded.phase,message=excluded.message,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE access_reports.release_id<excluded.release_id OR access_reports.phase=excluded.phase OR access_reports.phase='failed' OR (access_reports.phase='validated' AND excluded.phase IN ('reload_requested','observed','failed')) OR (access_reports.phase='reload_requested' AND excluded.phase IN ('observed','failed'))`, c.Phase, c.Message, c.ReleaseID, c.NodeID)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e == nil && n == 0 {
		return ErrConflict
	}
	return e
}
func (r Repository) Match(ctx context.Context, c MatchCommand) error {
	ip, e := netip.ParseAddr(c.IP)
	if e != nil || ip.Zone() != "" || len(c.Key) < 8 || len(c.Key) > 160 || c.ReleaseID < 1 || c.RuleID < 1 {
		return ErrInvalid
	}
	// Flags/actions come from the immutable release, never from agent assertions.
	res, e := r.Writer.ExecContext(ctx, `INSERT OR IGNORE INTO access_events(node_id,event_key,release_id,rule_id,ip,action,reputation,alert)
 SELECT n.id,?,r.id,json_extract(j.value,'$.id'),?,json_extract(j.value,'$.action'),json_extract(j.value,'$.reputation'),json_extract(j.value,'$.alert') FROM access_releases r JOIN json_each(r.payload,'$.rules') j JOIN cluster_nodes n ON n.id=? WHERE r.id=? AND json_extract(j.value,'$.id')=?`, c.Key, ip.Unmap().String(), c.NodeID, c.ReleaseID, c.RuleID)
	if e != nil {
		return e
	}
	count, e := res.RowsAffected()
	if e != nil {
		return e
	}
	if count == 0 {
		var exists int
		e = r.Reader.QueryRowContext(ctx, `SELECT count(*) FROM access_events WHERE node_id=? AND event_key=? AND release_id=? AND rule_id=? AND ip=?`, c.NodeID, c.Key, c.ReleaseID, c.RuleID, ip.Unmap().String()).Scan(&exists)
		if e != nil {
			return e
		}
		if exists == 0 {
			return ErrConflict
		}
	}
	return nil
}
func (r Repository) Activity(ctx context.Context) ([]ActivityItem, error) {
	rows, e := r.Reader.QueryContext(ctx, `WITH risk AS (SELECT ip,min(count(*),1000) score FROM access_events WHERE reputation=1 GROUP BY ip)
 SELECT e.node_id,e.rule_id,e.release_id,e.ip,e.action,e.reputation,e.alert,e.created_at,coalesce(r.score,0) FROM access_events e LEFT JOIN risk r ON r.ip=e.ip ORDER BY e.created_at DESC LIMIT 200`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []ActivityItem{}
	for rows.Next() {
		var v ActivityItem
		if e = rows.Scan(&v.NodeID, &v.RuleID, &v.ReleaseID, &v.IP, &v.Action, &v.Reputation, &v.Alert, &v.CreatedAt, &v.RiskScore); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
