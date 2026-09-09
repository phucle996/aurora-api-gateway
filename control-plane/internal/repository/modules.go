package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type ModuleStoreRepository struct {
	writer, reader *sql.DB
}

func NewModuleStoreRepository(w, r *sql.DB) *ModuleStoreRepository {
	return &ModuleStoreRepository{writer: w, reader: r}
}

func (r *ModuleStoreRepository) ListModules(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error) {
	rows, e := r.reader.QueryContext(ctx, `WITH latest_job AS (
		SELECT *, row_number() OVER(PARTITION BY node_id ORDER BY id DESC) rank FROM module_jobs
	)
	SELECT n.id,
	       coalesce(d.checked_at,0),
	       coalesce(d.nginx_version,''),
	       coalesce(d.architecture,''),
	       coalesce(d.modules_json,'[]'),
	       coalesce(d.installable,0),
	       coalesce(d.error,''),
	       coalesce(j.id,0),
	       coalesce(j.action,''),
	       coalesce(j.state,''),
	       coalesce(j.message,''),
	       coalesce(j.logs,'')
	FROM cluster_nodes n
	LEFT JOIN node_modules d ON d.node_id=n.id
	LEFT JOIN latest_job j ON j.node_id=n.id AND j.rank=1
	ORDER BY n.id`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()

	var out []entity.ModuleStoreNode
	for rows.Next() {
		var v entity.ModuleStoreNode
		var modules string
		if e = rows.Scan(&v.NodeID, &v.CheckedAt, &v.NginxVersion, &v.Architecture, &modules, &v.Installable, &v.Error, &v.JobID, &v.JobAction, &v.JobState, &v.JobMessage, &v.JobLogs); e != nil {
			return nil, e
		}
		var rawMods []repoModuleItem
		if e = json.Unmarshal([]byte(modules), &rawMods); e != nil {
			return nil, e
		}
		v.Modules = make([]entity.ModuleStoreNodeModule, len(rawMods))
		for i, m := range rawMods {
			v.Modules[i] = entity.ModuleStoreNodeModule{
				Name:      m.Name,
				Available: m.Available,
				Loaded:    m.Loaded,
				Source:    m.Source,
			}
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (r *ModuleStoreRepository) QueueJob(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error) {
	var out entity.QueueModuleJobResult
	now := time.Now().UnixMilli()
	e := r.writer.QueryRowContext(ctx, `WITH authority AS (
		SELECT n.id FROM cluster_nodes n LEFT JOIN node_modules d ON d.node_id=n.id
		WHERE n.id=? AND (?='check' OR (d.checked_at>? AND d.installable=1))
	)
	INSERT INTO module_jobs(node_id,action,state,requested_by,created_at,updated_at)
	SELECT id,?,'pending',?,?,? FROM authority WHERE true
	ON CONFLICT(node_id) WHERE state IN ('pending','running') DO UPDATE SET node_id=excluded.node_id
	RETURNING id,action,state`, c.NodeID, c.Action, now-90000, c.Action, c.Actor, now, now).Scan(&out.ID, &out.Action, &out.State)
	if e == sql.ErrNoRows {
		return out, fmt.Errorf("node unknown, dependency report stale, or compatible Brotli artifact unavailable")
	}
	return out, e
}

func (r *ModuleStoreRepository) PollJob(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	var out entity.PollModuleJobResult
	e := r.writer.QueryRowContext(ctx, `WITH target AS (
		SELECT id FROM module_jobs WHERE node_id=? AND state IN ('pending','running') ORDER BY id LIMIT 1
	)
	UPDATE module_jobs SET state='running',updated_at=? WHERE id IN (SELECT id FROM target) RETURNING id,action`,
		q.NodeID, time.Now().UnixMilli()).Scan(&out.ID, &out.Action)
	if e == sql.ErrNoRows {
		return out, nil
	}
	return out, e
}

func (r *ModuleStoreRepository) ReportModules(ctx context.Context, c entity.ReportModuleCommand) error {
	rawMods := make([]repoModuleItem, len(c.Modules))
	for i, m := range c.Modules {
		rawMods[i] = repoModuleItem{
			Name:      m.Name,
			Available: m.Available,
			Loaded:    m.Loaded,
			Source:    m.Source,
		}
	}
	modules, e := json.Marshal(rawMods)
	if e != nil {
		return e
	}
	tx, e := r.writer.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()

	result, e := tx.ExecContext(ctx, `WITH authority AS (SELECT id FROM cluster_nodes WHERE id=?)
	INSERT INTO node_modules(node_id,checked_at,received_at,nginx_version,architecture,modules_json,installable,error)
	SELECT id,?,?,?,?,?,?,? FROM authority WHERE true
	ON CONFLICT(node_id) DO UPDATE SET checked_at=excluded.checked_at,received_at=excluded.received_at,nginx_version=excluded.nginx_version,architecture=excluded.architecture,modules_json=excluded.modules_json,installable=excluded.installable,error=excluded.error
	WHERE excluded.checked_at>=node_modules.checked_at`,
		c.NodeID, c.CheckedAt, time.Now().UnixMilli(), c.NginxVersion, c.Architecture, string(modules), c.Installable, c.Error)
	if e != nil {
		return e
	}
	n, e := result.RowsAffected()
	if e != nil {
		return e
	}
	if n == 0 {
		return fmt.Errorf("unknown node or stale dependency report")
	}

	if c.JobID > 0 {
		var action, state string
		e = tx.QueryRowContext(ctx, `SELECT action,state FROM module_jobs WHERE id=? AND node_id=?`, c.JobID, c.NodeID).Scan(&action, &state)
		if e != nil {
			return fmt.Errorf("unknown dependency job")
		}
		if state == "succeeded" || state == "failed" {
			if state != c.JobState {
				return fmt.Errorf("terminal dependency result cannot change")
			}
		} else {
			if c.JobState == "succeeded" && action == "install_brotli" {
				loaded := false
				for _, m := range c.Modules {
					if m.Name == "brotli" && m.Loaded {
						loaded = true
					}
				}
				if !loaded {
					return fmt.Errorf("Brotli installation lacks observed runtime proof")
				}
			}
			_, e = tx.ExecContext(ctx, `UPDATE module_jobs SET state=?,message=?,logs=case when ? != '' then ? else logs end,updated_at=? WHERE id=? AND node_id=? AND state IN ('pending','running')`,
				c.JobState, c.JobMessage, c.JobLogs, c.JobLogs, time.Now().UnixMilli(), c.JobID, c.NodeID)
			if e != nil {
				return e
			}
		}
	}
	return tx.Commit()
}

func (r *ModuleStoreRepository) GetJobLogs(ctx context.Context, jobID int64) (*entity.ModuleJobLogs, error) {
	var logs entity.ModuleJobLogs
	e := r.reader.QueryRowContext(ctx, `SELECT id,node_id,action,state,message,logs,created_at,updated_at FROM module_jobs WHERE id=?`, jobID).
		Scan(&logs.ID, &logs.NodeID, &logs.Action, &logs.State, &logs.Message, &logs.Logs, &logs.CreatedAt, &logs.UpdatedAt)
	if e != nil {
		return nil, e
	}
	return &logs, nil
}

type repoModuleItem struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Loaded    bool   `json:"loaded"`
	Source    string `json:"source"`
}
