package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

type DependenciesRepository struct{ writer, reader *sql.DB }

func NewDependenciesRepository(w, r *sql.DB) *DependenciesRepository {
	return &DependenciesRepository{w, r}
}
func (r *DependenciesRepository) ListDependencies(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error) {
	rows, e := r.reader.QueryContext(ctx, `WITH latest_job AS (SELECT *,row_number() OVER(PARTITION BY node_id ORDER BY id DESC) rank FROM dependency_jobs)
 SELECT n.id,coalesce(d.checked_at,0),coalesce(d.nginx_version,''),coalesce(d.architecture,''),coalesce(d.modules_json,'[]'),coalesce(d.installable,0),coalesce(d.error,''),coalesce(j.id,0),coalesce(j.action,''),coalesce(j.state,''),coalesce(j.message,'')
 FROM cluster_nodes n LEFT JOIN node_dependencies d ON d.node_id=n.id LEFT JOIN latest_job j ON j.node_id=n.id AND j.rank=1 ORDER BY n.id`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []entity.DependencyNode{}
	for rows.Next() {
		var v entity.DependencyNode
		var modules string
		if e = rows.Scan(&v.NodeID, &v.CheckedAt, &v.NginxVersion, &v.Architecture, &modules, &v.Installable, &v.Error, &v.JobID, &v.JobAction, &v.JobState, &v.JobMessage); e != nil {
			return nil, e
		}
		if e = json.Unmarshal([]byte(modules), &v.Modules); e != nil {
			return nil, e
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (r *DependenciesRepository) QueueDependency(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error) {
	var out entity.QueueDependencyResult
	now := time.Now().UnixMilli()
	e := r.writer.QueryRowContext(ctx, `WITH authority AS (
 SELECT n.id FROM cluster_nodes n LEFT JOIN node_dependencies d ON d.node_id=n.id
 WHERE n.id=? AND (?='check' OR (d.checked_at>? AND d.installable=1)))
 INSERT INTO dependency_jobs(node_id,action,state,requested_by,created_at,updated_at)
 SELECT id,?,'pending',?,?,? FROM authority WHERE true
 ON CONFLICT(node_id) WHERE state IN ('pending','running') DO UPDATE SET node_id=excluded.node_id
 RETURNING id,action,state`, c.NodeID, c.Action, now-90000, c.Action, c.Actor, now, now).Scan(&out.ID, &out.Action, &out.State)
	if e == sql.ErrNoRows {
		return out, fmt.Errorf("node unknown, dependency report stale, or compatible Brotli artifact unavailable")
	}
	return out, e
}
func (r *DependenciesRepository) PollDependency(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error) {
	var out entity.PollDependencyResult
	e := r.writer.QueryRowContext(ctx, `WITH target AS (SELECT id FROM dependency_jobs WHERE node_id=? AND state IN ('pending','running') ORDER BY id LIMIT 1)
 UPDATE dependency_jobs SET state='running',updated_at=? WHERE id IN (SELECT id FROM target) RETURNING id,action`, q.NodeID, time.Now().UnixMilli()).Scan(&out.ID, &out.Action)
	if e == sql.ErrNoRows {
		return out, nil
	}
	return out, e
}
func (r *DependenciesRepository) ReportDependency(ctx context.Context, c entity.ReportDependencyCommand) error {
	modules, e := json.Marshal(c.Modules)
	if e != nil {
		return e
	}
	tx, e := r.writer.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	result, e := tx.ExecContext(ctx, `WITH authority AS (SELECT id FROM cluster_nodes WHERE id=?)
 INSERT INTO node_dependencies(node_id,checked_at,received_at,nginx_version,architecture,modules_json,installable,error)
 SELECT id,?,?,?,?,?,?,? FROM authority WHERE true
 ON CONFLICT(node_id) DO UPDATE SET checked_at=excluded.checked_at,received_at=excluded.received_at,nginx_version=excluded.nginx_version,architecture=excluded.architecture,modules_json=excluded.modules_json,installable=excluded.installable,error=excluded.error
 WHERE excluded.checked_at>=node_dependencies.checked_at`, c.NodeID, c.CheckedAt, time.Now().UnixMilli(), c.NginxVersion, c.Architecture, string(modules), c.Installable, c.Error)
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
		e = tx.QueryRowContext(ctx, `SELECT action,state FROM dependency_jobs WHERE id=? AND node_id=?`, c.JobID, c.NodeID).Scan(&action, &state)
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
			_, e = tx.ExecContext(ctx, `UPDATE dependency_jobs SET state=?,message=?,updated_at=? WHERE id=? AND node_id=? AND state IN ('pending','running')`, c.JobState, c.JobMessage, time.Now().UnixMilli(), c.JobID, c.NodeID)
			if e != nil {
				return e
			}
		}
	}
	return tx.Commit()
}
