package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"sort"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

type accessRepository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewAccessRepository creates a new SQLite-backed repository for access control.
func NewAccessRepository(writer, reader *sql.DB) repo.AccessRepository {
	return &accessRepository{
		writer: writer,
		reader: reader,
	}
}

type accessReceipt struct {
	ID        int64 `json:"id"`
	Version   int64 `json:"version"`
	ReleaseID int64 `json:"release_id"`
}

type accessRuleDoc struct {
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

type accessGroupDoc struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Networks    []string `json:"networks"`
}

type accessDatasetNetworkDoc struct {
	CIDR    string `json:"cidr"`
	Country string `json:"country"`
	ASN     string `json:"asn"`
}

type accessDatasetDoc struct {
	Name     string                    `json:"name"`
	Networks []accessDatasetNetworkDoc `json:"networks"`
}

type accessRuntimeRule struct {
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

func (r *accessRepository) Change(ctx context.Context, c entity.AccessChangeCommand, compile func(context.Context, []byte) error) (entity.AccessChangeResult, error) {
	var out entity.AccessChangeResult
	tx, e := r.writer.BeginTx(ctx, nil)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()

	inputPayload := struct {
		ID              int64           `json:"id"`
		Kind            string          `json:"kind"`
		ExpectedVersion int64           `json:"expected_version"`
		ExpectedRelease int64           `json:"expected_release"`
		Delete          bool            `json:"delete"`
		Document        json.RawMessage `json:"document"`
	}{
		ID:              c.ID,
		Kind:            c.Kind,
		ExpectedVersion: c.ExpectedVersion,
		ExpectedRelease: c.ExpectedRelease,
		Delete:          c.Delete,
		Document:        c.Document,
	}
	input, _ := json.Marshal(inputPayload)
	hash := fmt.Sprintf("%x", sha256.Sum256(input))
	var oldHash, receipt string
	e = tx.QueryRowContext(ctx, `SELECT request_hash,result FROM access_receipts WHERE actor=? AND request_key=?`, c.Actor, c.Key).Scan(&oldHash, &receipt)
	if e == nil {
		if hash != oldHash {
			return out, taxonomy.ErrAccessConflict
		}
		var rec accessReceipt
		if e = json.Unmarshal([]byte(receipt), &rec); e != nil {
			return out, e
		}
		out = entity.AccessChangeResult{
			ID:        rec.ID,
			Version:   rec.Version,
			ReleaseID: rec.ReleaseID,
		}
		return out, nil
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
		return out, taxonomy.ErrAccessConflict
	}

	if c.ID > 0 {
		e = tx.QueryRowContext(ctx, `SELECT kind,version,deleted FROM access_objects WHERE id=?`, c.ID).Scan(&kind, &version, &deleted)
		if errors.Is(e, sql.ErrNoRows) {
			return out, taxonomy.ErrAccessMissing
		}
		if e != nil {
			return out, e
		}
		if deleted || kind != c.Kind || version != c.ExpectedVersion {
			return out, taxonomy.ErrAccessConflict
		}
	}

	if c.ID == 0 {
		var count int
		if e = tx.QueryRowContext(ctx, `SELECT count(*) FROM access_objects WHERE deleted=0`).Scan(&count); e != nil {
			return out, e
		}
		if count >= 4096 {
			return out, taxonomy.ErrAccessConflict
		}
		res, ie := tx.ExecContext(ctx, `INSERT INTO access_objects(kind,version,document,deleted) VALUES(?,1,?,?)`, c.Kind, string(c.Document), c.Delete)
		if ie != nil {
			return out, ie
		}
		c.ID, _ = res.LastInsertId()
		version = 0
	} else {
		_, e = tx.ExecContext(ctx, `UPDATE access_objects SET version=version+1,document=?,deleted=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, string(c.Document), c.Delete, c.ID)
		if e != nil {
			return out, e
		}
	}

	_, e = tx.ExecContext(ctx, `INSERT INTO access_revisions(object_id,kind,version,document,deleted,actor) VALUES(?,?,?,?,?,?)`, c.ID, c.Kind, version+1, string(c.Document), c.Delete, c.Actor)
	if e != nil {
		return out, e
	}

	rows, e := tx.QueryContext(ctx, `
		WITH active AS (
			SELECT id, kind, document
			FROM access_objects
			WHERE deleted = 0
		)
		SELECT id, kind, document
		FROM active
		ORDER BY id`)
	if e != nil {
		return out, e
	}

	type authority struct {
		id   int64
		rule accessRuleDoc
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
			var v accessRuleDoc
			e = json.Unmarshal([]byte(raw), &v)
			rules = append(rules, authority{id, v})
		case "group":
			var v accessGroupDoc
			e = json.Unmarshal([]byte(raw), &v)
			groups[fmt.Sprint(id)] = v.Networks
		case "dataset":
			var v accessDatasetDoc
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

	runtime := []accessRuntimeRule{}
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
				return out, fmt.Errorf("%w: rule %s has an unresolved %s source; import networks or disable the rule", taxonomy.ErrAccessInvalid, v.Name, v.Source)
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
		runtime = append(runtime, accessRuntimeRule{
			ID:         a.id,
			Priority:   v.Priority,
			Action:     v.Action,
			Networks:   unique,
			Host:       v.Host,
			Path:       v.Path,
			Method:     v.Method,
			Schedule:   v.Schedule,
			ExpiresAt:  v.ExpiresAt,
			Log:        v.Log,
			Reputation: v.Reputation,
			Alert:      v.Alert,
		})
	}
	sort.Slice(runtime, func(i, j int) bool {
		if runtime[i].Priority == runtime[j].Priority {
			return runtime[i].ID < runtime[j].ID
		}
		return runtime[i].Priority < runtime[j].Priority
	})

	next := head + 1
	payload, e := json.Marshal(struct {
		Schema     int                 `json:"schema_version"`
		Generation int64               `json:"generation"`
		Rules      []accessRuntimeRule `json:"rules"`
	}{1, next, runtime})
	if e != nil {
		return out, e
	}

	if e = compile(ctx, payload); e != nil {
		return out, e
	}

	digest := fmt.Sprintf("%x", sha256.Sum256(payload))
	if _, e = tx.ExecContext(ctx, `INSERT INTO access_releases(id,digest,payload,actor) VALUES(?,?,?,?)`, next, digest, string(payload), c.Actor); e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO access_head(singleton,release_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET release_id=excluded.release_id`, next); e != nil {
		return out, e
	}

	out = entity.AccessChangeResult{
		ID:        c.ID,
		Version:   version + 1,
		ReleaseID: next,
	}
	receiptPayload, _ := json.Marshal(accessReceipt{
		ID:        out.ID,
		Version:   out.Version,
		ReleaseID: out.ReleaseID,
	})
	_, e = tx.ExecContext(ctx, `INSERT INTO access_receipts(actor,request_key,request_hash,result) VALUES(?,?,?,?)`, c.Actor, c.Key, hash, string(receiptPayload))
	if e != nil {
		return out, e
	}

	return out, tx.Commit()
}

func (r *accessRepository) Read(ctx context.Context, q entity.AccessReadQuery) ([]entity.AccessReadItem, error) {
	var rows *sql.Rows
	var e error
	if q.History {
		rows, e = r.reader.QueryContext(ctx, `SELECT object_id,kind,version,document,deleted,created_at,actor FROM access_revisions WHERE object_id=? ORDER BY version DESC`, q.ID)
	} else if q.ID > 0 {
		rows, e = r.reader.QueryContext(ctx, `SELECT id,kind,version,document,deleted,updated_at,'' FROM access_objects WHERE id=? AND deleted=0`, q.ID)
	} else {
		rows, e = r.reader.QueryContext(ctx, `SELECT id,kind,version,document,deleted,updated_at,'' FROM access_objects WHERE deleted=0 ORDER BY id DESC`)
	}
	if e != nil {
		return nil, e
	}
	defer rows.Close()

	out := []entity.AccessReadItem{}
	for rows.Next() {
		var item entity.AccessReadItem
		var raw string
		if e = rows.Scan(&item.ID, &item.Kind, &item.Version, &raw, &item.Deleted, &item.UpdatedAt, &item.Actor); e != nil {
			return nil, e
		}
		item.Document = json.RawMessage(raw)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *accessRepository) Status(ctx context.Context) (entity.AccessStatusResult, error) {
	var out entity.AccessStatusResult
	rows, e := r.reader.QueryContext(ctx, `
		WITH head AS (
			SELECT coalesce((SELECT release_id FROM access_head WHERE singleton = 1), 0) AS id
		)
		SELECT
			head.id,
			coalesce(n.id, ''),
			coalesce(r.release_id, 0),
			CASE
				WHEN r.release_id = head.id THEN
					CASE
						WHEN unixepoch('now') - unixepoch(r.updated_at) > 45 THEN 'stale'
						ELSE r.phase
					END
				ELSE 'pending'
			END,
			coalesce(r.message, ''),
			coalesce(r.updated_at, '')
		FROM head
		LEFT JOIN cluster_nodes n ON 1 = 1
		LEFT JOIN access_reports r ON r.node_id = n.id
		ORDER BY n.id`)
	if e != nil {
		return out, e
	}
	defer rows.Close()

	out.Nodes = []entity.AccessStatusNode{}
	for rows.Next() {
		var n entity.AccessStatusNode
		if e = rows.Scan(&out.ReleaseID, &n.ID, &n.ReleaseID, &n.Phase, &n.Message, &n.UpdatedAt); e != nil {
			return out, e
		}
		if n.ID != "" {
			out.Nodes = append(out.Nodes, n)
		}
	}
	return out, rows.Err()
}

func (r *accessRepository) Desired(ctx context.Context, q entity.AccessSyncQuery) (entity.AccessSyncResult, error) {
	var out entity.AccessSyncResult
	var b []byte
	e := r.reader.QueryRowContext(ctx, `SELECT coalesce(r.id,0),coalesce(r.digest,''),coalesce(r.payload,'null') FROM cluster_nodes n LEFT JOIN access_head h ON h.singleton=1 LEFT JOIN access_releases r ON r.id=h.release_id WHERE n.id=?`, q.NodeID).Scan(&out.ReleaseID, &out.Digest, &b)
	if errors.Is(e, sql.ErrNoRows) {
		return out, taxonomy.ErrAccessMissing
	}
	out.Payload = b
	return out, e
}

func (r *accessRepository) Report(ctx context.Context, c entity.AccessReportCommand) error {
	if c.ReleaseID < 1 || len(c.Message) > 512 {
		return taxonomy.ErrAccessInvalid
	}
	switch c.Phase {
	case "validated", "reload_requested", "observed", "failed":
	default:
		return taxonomy.ErrAccessInvalid
	}

	res, e := r.writer.ExecContext(ctx, `
		INSERT INTO access_reports (node_id, release_id, phase, message)
		SELECT n.id, h.release_id, ?, ?
		FROM cluster_nodes n
		JOIN access_head h ON h.release_id = ?
		WHERE n.id = ?
		ON CONFLICT(node_id) DO UPDATE SET
			release_id = excluded.release_id,
			phase = excluded.phase,
			message = excluded.message,
			updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		WHERE access_reports.release_id < excluded.release_id
		   OR access_reports.phase = excluded.phase
		   OR access_reports.phase = 'failed'
		   OR (access_reports.phase = 'validated' AND excluded.phase IN ('reload_requested', 'observed', 'failed'))
		   OR (access_reports.phase = 'reload_requested' AND excluded.phase IN ('observed', 'failed'))`,
		c.Phase, c.Message, c.ReleaseID, c.NodeID)
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e == nil && n == 0 {
		return taxonomy.ErrAccessConflict
	}
	return e
}

func (r *accessRepository) Match(ctx context.Context, c entity.AccessMatchCommand) error {
	ip, e := netip.ParseAddr(c.IP)
	if e != nil || ip.Zone() != "" || len(c.Key) < 8 || len(c.Key) > 160 || c.ReleaseID < 1 || c.RuleID < 1 {
		return taxonomy.ErrAccessInvalid
	}

	res, e := r.writer.ExecContext(ctx, `INSERT OR IGNORE INTO access_events(node_id,event_key,release_id,rule_id,ip,action,reputation,alert)
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
		e = r.reader.QueryRowContext(ctx, `SELECT count(*) FROM access_events WHERE node_id=? AND event_key=? AND release_id=? AND rule_id=? AND ip=?`, c.NodeID, c.Key, c.ReleaseID, c.RuleID, ip.Unmap().String()).Scan(&exists)
		if e != nil {
			return e
		}
		if exists == 0 {
			return taxonomy.ErrAccessConflict
		}
	}
	return nil
}

func (r *accessRepository) Activity(ctx context.Context) ([]entity.AccessActivityItem, error) {
	rows, e := r.reader.QueryContext(ctx, `
		WITH risk AS (
			SELECT ip, min(count(*), 1000) AS score
			FROM access_events
			WHERE reputation = 1
			GROUP BY ip
		)
		SELECT
			e.node_id,
			e.rule_id,
			e.release_id,
			e.ip,
			e.action,
			e.reputation,
			e.alert,
			e.created_at,
			coalesce(r.score, 0)
		FROM access_events e
		LEFT JOIN risk r ON r.ip = e.ip
		ORDER BY e.created_at DESC
		LIMIT 200`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()

	out := []entity.AccessActivityItem{}
	for rows.Next() {
		var v entity.AccessActivityItem
		if e = rows.Scan(&v.NodeID, &v.RuleID, &v.ReleaseID, &v.IP, &v.Action, &v.Reputation, &v.Alert, &v.CreatedAt, &v.RiskScore); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *accessRepository) Catalog(ctx context.Context) (entity.AccessCatalog, error) {
	catalog := entity.AccessCatalog{
		Hosts:     []string{},
		Countries: []entity.AccessCatalogCountry{},
		ASNs:      []entity.AccessCatalogASN{},
	}

	// 1. Query distinct non-wildcard hosts protected by the system
	rows, err := r.reader.QueryContext(ctx, `WITH policy_hosts AS (
    SELECT DISTINCT json_extract(document, '$.host') AS host
    FROM policies
    WHERE status != 'Disabled' AND json_extract(document, '$.host') IS NOT NULL AND json_extract(document, '$.host') != '*' AND json_extract(document, '$.host') != ''
),
rule_hosts AS (
    SELECT DISTINCT json_extract(document, '$.host') AS host
    FROM access_objects
    WHERE kind = 'rule' AND deleted = 0 AND json_extract(document, '$.host') IS NOT NULL AND json_extract(document, '$.host') != '*' AND json_extract(document, '$.host') != ''
)
SELECT host FROM policy_hosts UNION SELECT host FROM rule_hosts ORDER BY host ASC`)
	if err == nil {
		for rows.Next() {
			var h string
			if rows.Scan(&h) == nil && h != "" {
				catalog.Hosts = append(catalog.Hosts, h)
			}
		}
		rows.Close()
	}

	// 2. Query active datasets to extract available Country codes and ASNs with counts
	datasetRows, err := r.reader.QueryContext(ctx, `SELECT document FROM access_objects WHERE kind = 'dataset' AND deleted = 0`)
	if err == nil {
		defer datasetRows.Close()

		countryCounts := make(map[string]int)
		asnCounts := make(map[string]int)

		for datasetRows.Next() {
			var rawDoc string
			if datasetRows.Scan(&rawDoc) == nil {
				var doc accessDatasetDoc
				if json.Unmarshal([]byte(rawDoc), &doc) == nil {
					for _, net := range doc.Networks {
						if net.Country != "" {
							countryCounts[net.Country]++
						}
						if net.ASN != "" {
							asnCounts[net.ASN]++
						}
					}
				}
			}
		}

		for c, count := range countryCounts {
			catalog.Countries = append(catalog.Countries, entity.AccessCatalogCountry{
				Code:      c,
				CIDRCount: count,
			})
		}
		sort.Slice(catalog.Countries, func(i, j int) bool {
			return catalog.Countries[i].Code < catalog.Countries[j].Code
		})

		for a, count := range asnCounts {
			catalog.ASNs = append(catalog.ASNs, entity.AccessCatalogASN{
				ASN:       a,
				CIDRCount: count,
			})
		}
		sort.Slice(catalog.ASNs, func(i, j int) bool {
			return catalog.ASNs[i].ASN < catalog.ASNs[j].ASN
		})
	}

	return catalog, nil
}
