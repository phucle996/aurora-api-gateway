package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
)

type createDefinitionRepository struct{ db *sql.DB }

func NewCreateRuleDefinitionRepository(db *sql.DB) repo.CreateRuleDefinitionRepository {
	return &createDefinitionRepository{db}
}
func (r *createDefinitionRepository) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand, issues []string, path string) (entity.CreateRuleDefinitionResult, error) {
	out := entity.CreateRuleDefinitionResult{Version: 1, State: "saved", RuntimeReady: len(issues) == 0, RuntimeIssues: issues}
	raw, err := json.Marshal(c)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var previousHash, previousIssues string
	err = tx.QueryRowContext(ctx, `WITH prior AS(SELECT * FROM definition_creates WHERE request_key=?)
 SELECT p.rule_id,p.version,p.request_hash,d.runtime_ready,d.runtime_issues FROM prior p JOIN rule_definitions d ON d.rule_id=p.rule_id AND d.version=p.version`, c.RequestKey).Scan(&out.ID, &out.Version, &previousHash, &out.RuntimeReady, &previousIssues)
	if err == nil {
		if hash != previousHash {
			return out, entity.ErrRuleConflict
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
		return out, entity.ErrRuleInvalid
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
