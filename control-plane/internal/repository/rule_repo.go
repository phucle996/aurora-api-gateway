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
	"strconv"
	"time"
)

// ruleRepository là struct duy nhất cho toàn bộ rule workflow.
// writer: dùng cho thao tác ghi (CREATE, UPDATE, PUBLISH).
// reader: dùng cho thao tác đọc (LIST, DETAIL, STATS, HISTORY).
type ruleRepository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewRuleRepository tạo ruleRepository với 2 pool riêng biệt.
// Caller (module.go) truyền đúng pool tương ứng với loại thao tác.
func NewRuleRepository(writer, reader *sql.DB) *ruleRepository {
	return &ruleRepository{writer: writer, reader: reader}
}

// ─── List Rules ───────────────────────────────────────────────────────────────

func (r *ruleRepository) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	out := entity.ListRulesResult{Items: []entity.ListRulesItem{}}
	rows, err := r.reader.QueryContext(ctx, `WITH filtered AS (
SELECT r.*,CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END schema_version,coalesce(d.runtime_ready,1) runtime_ready
FROM rules r LEFT JOIN rule_definitions d ON d.rule_id=r.id AND d.version=r.version
WHERE (?='' OR instr(lower(name),lower(?))>0)
AND (?='' OR rule_group=?) AND (?='' OR action=?) AND (?='' OR severity=?)
AND (?='' OR enabled=CASE ? WHEN 'true' THEN 1 ELSE 0 END))
 ,page AS (SELECT * FROM filtered WHERE id>? ORDER BY id LIMIT ?),
 totals AS (SELECT count(*) total FROM filtered)
SELECT totals.total,coalesce(id,0),coalesce(version,0),coalesce(name,''),coalesce(description,''),coalesce(rule_group,''),coalesce(action,''),coalesce(severity,''),coalesce(score,0),coalesce(priority,0),coalesce(path,''),coalesce(enabled,0),coalesce(updated_at,''),coalesce(schema_version,0),coalesce(runtime_ready,0)
FROM totals LEFT JOIN page ON 1=1 ORDER BY id`,
		q.Search, q.Search, q.Group, q.Group, q.Action, q.Action, q.Severity, q.Severity, q.Enabled, q.Enabled, q.After, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var x entity.ListRulesItem
		if err = rows.Scan(&out.Total, &x.ID, &x.Version, &x.Name, &x.Description, &x.Group, &x.Action, &x.Severity, &x.Score, &x.Priority, &x.Path, &x.Enabled, &x.UpdatedAt, &x.SchemaVersion, &x.RuntimeReady); err != nil {
			return out, err
		}
		if x.ID != 0 {
			out.Items = append(out.Items, x)
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextAfter = strconv.FormatInt(out.Items[len(out.Items)-1].ID, 10)
	}
	return out, nil
}

// ─── Rule Detail ──────────────────────────────────────────────────────────────

func (r *ruleRepository) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	var x entity.RuleDetailResult
	var conditions, issues string
	err := r.reader.QueryRowContext(ctx, `WITH target AS(SELECT * FROM rules WHERE id=?)
SELECT t.id,t.version,t.name,t.description,t.rule_group,t.action,t.severity,t.score,t.priority,t.path,t.enabled,t.updated_at,
CASE WHEN d.rule_id IS NULL THEN 1 ELSE 2 END,coalesce(d.runtime_ready,1),coalesce(d.runtime_issues,'[]'),
coalesce(d.logic_mode,'all'),coalesce(d.conditions_json,'[]'),coalesce(d.source_ip,''),coalesce(d.host_domain,''),coalesce(d.path_prefix,''),coalesce(d.http_method,''),d.response_code,coalesce(d.custom_response,''),coalesce(d.log_event,0),coalesce(d.add_to_reputation,0)
FROM target t LEFT JOIN rule_definitions d ON d.rule_id=t.id AND d.version=t.version`, q.ID).Scan(&x.ID, &x.Version, &x.Name, &x.Description, &x.Group, &x.Action, &x.Severity, &x.Score, &x.Priority, &x.Path, &x.Enabled, &x.UpdatedAt,
		&x.SchemaVersion, &x.RuntimeReady, &issues, &x.LogicMode, &conditions, &x.SourceIP, &x.HostDomain, &x.PathPrefix, &x.HTTPMethod, &x.ResponseCode, &x.CustomResponse, &x.LogEvent, &x.AddToReputation)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	if err != nil {
		return x, err
	}
	if err = json.Unmarshal([]byte(conditions), &x.Conditions); err != nil {
		return x, err
	}
	if err = json.Unmarshal([]byte(issues), &x.RuntimeIssues); err != nil {
		return x, err
	}
	if x.SchemaVersion == 1 {
		x.Conditions = []entity.RuleDetailCondition{{Field: "path", Operator: "equals", Value: x.Path}}
		if x.Action == "block" {
			code := 403
			x.ResponseCode = &code
		}
	}
	return x, err
}

// ─── Rule Stats ───────────────────────────────────────────────────────────────

func (r *ruleRepository) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	var x entity.RuleStatsResult
	if q.AsOf.IsZero() {
		return x, taxonomy.ErrRuleInvalid
	}
	asOf := q.AsOf.UTC()
	x.AsOf = asOf.Format(time.RFC3339Nano)
	x.ComparisonBefore = time.Date(asOf.Year(), asOf.Month(), 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	// One SQLite read snapshot for all cards and their historical baseline. Latest
	// revision BEFORE the UTC month boundary, not count of edits/creates this month.
	err := r.reader.QueryRowContext(ctx, `WITH
 coverage AS (SELECT coalesce(min(julianday(applied_at)) <= julianday(?),0) available FROM schema_migrations WHERE version=2),
 winners AS (SELECT rule_id,max(version) version FROM rule_revisions WHERE julianday(updated_at)<julianday(?) GROUP BY rule_id),
 baseline AS (SELECT count(*) total,coalesce(sum(r.enabled),0) enabled,
 coalesce(sum(r.enabled=1 AND r.action='log'),0) logs,coalesce(sum(r.enabled=1 AND r.action='block'),0) blocks
 FROM rule_revisions r JOIN winners w ON w.rule_id=r.rule_id AND w.version=r.version),
 totals AS (SELECT count(*) total,coalesce(sum(enabled),0) enabled,
 coalesce(sum(enabled=1 AND action='log'),0) logs,coalesce(sum(enabled=1 AND action='block'),0) blocks FROM rules)
 SELECT t.total,t.enabled,t.logs,t.blocks,c.available,
 CASE WHEN c.available THEN t.total-b.total END,CASE WHEN c.available THEN t.enabled-b.enabled END,
 CASE WHEN c.available THEN t.logs-b.logs END,CASE WHEN c.available THEN t.blocks-b.blocks END
 FROM totals t CROSS JOIN baseline b CROSS JOIN coverage c`, x.ComparisonBefore, x.ComparisonBefore).Scan(&x.Total, &x.Enabled, &x.Log, &x.Block, &x.HistoryAvailable, &x.TotalDelta, &x.EnabledDelta, &x.LogDelta, &x.BlockDelta)
	return x, err
}

// ─── Rule History ─────────────────────────────────────────────────────────────

func (r *ruleRepository) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	out := entity.RuleHistoryResult{Items: []entity.RuleHistoryRecord{}}
	rows, err := r.reader.QueryContext(ctx, `WITH selected AS(SELECT version,name,action,enabled,actor,updated_at FROM rule_revisions WHERE rule_id=? AND (?=0 OR version<?))
 SELECT version,name,action,enabled,actor,updated_at FROM selected ORDER BY version DESC LIMIT ?`, q.ID, q.Before, q.Before, q.Limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item entity.RuleHistoryRecord
		if err = rows.Scan(&item.Version, &item.Name, &item.Action, &item.Enabled, &item.Actor, &item.UpdatedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > q.Limit {
		out.Items = out.Items[:q.Limit]
		out.NextBefore = out.Items[q.Limit-1].Version
	}
	return out, nil
}

// ─── Create Rule ──────────────────────────────────────────────────────────────

func (r *ruleRepository) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	var out entity.CreateRuleResult
	raw, _ := json.Marshal(c)
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var prior string
	err = tx.QueryRowContext(ctx, "SELECT rule_id,request_hash FROM rule_creates WHERE request_key=?", c.RequestKey).Scan(&out.ID, &prior)
	if err == nil {
		if prior != hash {
			return out, taxonomy.ErrRuleConflict
		}
		out.Version = 1
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled)
VALUES(1,?,?,?,?,?,?,?,?,?) RETURNING id,version`, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled).Scan(&out.ID, &out.Version)
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO rule_creates VALUES(?,?,?)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// ─── Update Rule ──────────────────────────────────────────────────────────────

func (r *ruleRepository) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	var out entity.UpdateRuleResult
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	// Legacy replacement cannot drop a v2 definition's conditions/scope.
	var definitions int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rule_definitions WHERE rule_id=?", c.ID).Scan(&definitions); err != nil {
		return out, err
	}
	if definitions > 0 {
		return out, taxonomy.ErrRuleConflict
	}
	err = tx.QueryRowContext(ctx, `WITH target AS (SELECT id FROM rules WHERE id=? AND version=?)
UPDATE rules SET version=version+1,name=?,description=?,rule_group=?,action=?,severity=?,score=?,priority=?,path=?,enabled=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN(SELECT id FROM target) RETURNING id,version`, c.ID, c.ExpectedVersion, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, c.Path, c.Enabled).Scan(&out.ID, &out.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return out, taxonomy.ErrRuleConflict
	}
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// ─── Publish Rules ────────────────────────────────────────────────────────────

// publishRuleRecord là projection riêng của publish workflow.
// Không dùng chung với list/detail để tránh coupling giữa các workflow.
type publishRuleRecord struct {
	ID       int64  `json:"id"`
	Path     string `json:"path"`
	Action   string `json:"action"`
	Score    int    `json:"score"`
	Priority int    `json:"priority"`
}

func (r *ruleRepository) Reserve(ctx context.Context, c entity.PublishRulesCommand) (entity.PublishRulesSource, error) {
	var out entity.PublishRulesSource
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, "SELECT id,payload,state,digest FROM ruleset_releases WHERE request_key=?", c.RequestKey).Scan(&out.ID, &out.Payload, &out.State, &out.Digest)
	if err == nil {
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	// New definitions must never be flattened into the legacy exact-path IR.
	var unsupported int
	if err = tx.QueryRowContext(ctx, `WITH selected AS(SELECT id,version FROM rules WHERE enabled=1)
	SELECT count(*) FROM selected s JOIN rule_definitions d ON d.rule_id=s.id AND d.version=s.version WHERE d.runtime_ready=0`).Scan(&unsupported); err != nil {
		return out, err
	}
	if unsupported > 0 {
		return out, taxonomy.ErrRuleInvalid
	}
	if err = tx.QueryRowContext(ctx, "INSERT INTO ruleset_releases(request_key,state) VALUES(?,'pending') RETURNING id", c.RequestKey).Scan(&out.ID); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO release_rules(release_id,rule_id,version) SELECT ?,id,version FROM rules WHERE enabled=1`, out.ID); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `WITH selected AS(SELECT rule_id,version FROM release_rules WHERE release_id=?)
SELECT v.rule_id,v.path,v.action,v.score,v.priority FROM selected s JOIN rule_revisions v ON v.rule_id=s.rule_id AND v.version=s.version ORDER BY v.priority,v.rule_id`, out.ID)
	if err != nil {
		return out, err
	}
	rules := []publishRuleRecord{}
	for rows.Next() {
		var x publishRuleRecord
		if err = rows.Scan(&x.ID, &x.Path, &x.Action, &x.Score, &x.Priority); err != nil {
			rows.Close()
			return out, err
		}
		rules = append(rules, x)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Payload, err = json.Marshal(struct {
		SchemaVersion int                 `json:"schema_version"`
		Generation    int64               `json:"generation"`
		Rules         []publishRuleRecord `json:"rules"`
	}{2, out.ID, rules})
	if err != nil {
		return out, err
	}
	if len(out.Payload) > 65536 {
		return out, taxonomy.ErrRuleInvalid
	}
	if _, err = tx.ExecContext(ctx, "UPDATE ruleset_releases SET payload=? WHERE id=?", out.Payload, out.ID); err != nil {
		return out, err
	}
	out.State = "pending"
	return out, tx.Commit()
}

func (r *ruleRepository) Complete(ctx context.Context, id int64, digest string) error {
	_, err := r.writer.ExecContext(ctx, "UPDATE ruleset_releases SET digest=?,state='ready' WHERE id=? AND state='pending'", digest, id)
	return err
}

// ─── Release Detail ───────────────────────────────────────────────────────────

func (r *ruleRepository) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	var x entity.ReleaseDetailResult
	err := r.reader.QueryRowContext(ctx, `WITH target AS(SELECT * FROM ruleset_releases WHERE id=?)
SELECT t.id,t.state,t.digest,t.created_at,n.phase FROM target t LEFT JOIN node_activation n ON n.release_id=t.id`, q.ID).Scan(&x.ID, &x.State, &x.Digest, &x.CreatedAt, &x.ActivationPhase)
	if errors.Is(err, sql.ErrNoRows) {
		err = taxonomy.ErrRuleNotFound
	}
	return x, err
}

// ─── Create Rule Definition (v2) ─────────────────────────────────────────────

func (r *ruleRepository) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand, issues []string, path string) (entity.CreateRuleDefinitionResult, error) {
	out := entity.CreateRuleDefinitionResult{Version: 1, State: "saved", RuntimeReady: len(issues) == 0, RuntimeIssues: issues}
	raw, err := json.Marshal(c)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var previousHash, previousIssues string
	err = tx.QueryRowContext(ctx, `WITH prior AS(SELECT * FROM definition_creates WHERE request_key=?)
 SELECT p.rule_id,p.version,p.request_hash,d.runtime_ready,d.runtime_issues FROM prior p JOIN rule_definitions d ON d.rule_id=p.rule_id AND d.version=p.version`, c.RequestKey).Scan(&out.ID, &out.Version, &previousHash, &out.RuntimeReady, &previousIssues)
	if err == nil {
		if hash != previousHash {
			return out, taxonomy.ErrRuleConflict
		}
		if err = json.Unmarshal([]byte(previousIssues), &out.RuntimeIssues); err != nil {
			return out, err
		}
		return out, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM rules").Scan(&count); err != nil {
		return out, err
	}
	if count >= 1024 {
		return out, taxonomy.ErrRuleInvalid
	}
	if err = tx.QueryRowContext(ctx, `INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled)
 VALUES(1,?,?,?,?,?,?,?,?,?) RETURNING id`, c.Name, c.Description, c.Group, c.Action, c.Severity, c.Score, c.Priority, path, c.Enabled).Scan(&out.ID); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'management-token' FROM rules WHERE id=?`, out.ID); err != nil {
		return out, err
	}
	conditions, err := json.Marshal(c.Conditions)
	if err != nil {
		return out, err
	}
	reasons, err := json.Marshal(issues)
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO rule_definitions(rule_id,version,logic_mode,conditions_json,source_ip,host_domain,path_prefix,http_method,response_code,custom_response,log_event,add_to_reputation,runtime_ready,runtime_issues)
 VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?)`, out.ID, c.LogicMode, string(conditions), c.SourceIP, c.HostDomain, c.PathPrefix, c.HTTPMethod, c.ResponseCode, c.CustomResponse, c.LogEvent, c.AddToReputation, out.RuntimeReady, string(reasons)); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO definition_creates(request_key,request_hash,rule_id,version) VALUES(?,?,?,1)", c.RequestKey, hash, out.ID); err != nil {
		return out, err
	}
	return out, tx.Commit()
}

