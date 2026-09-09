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

// ListModules trả về danh sách các node kèm snapshot module và trạng thái job gần nhất.
func (r *ModuleStoreRepository) ListModules(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error) {
	// CTE latest_job: Xếp hạng (rank) các jobs của từng node theo ID giảm dần để lấy tác vụ mới nhất (rank = 1).
	// Query chính: Ghép nối cluster_nodes với thông tin quan trắc node_modules và latest_job để trả về projection phẳng.
	const query = `
		WITH latest_job AS (
			SELECT 
				id,
				node_id,
				action,
				state,
				message,
				logs,
				row_number() OVER (
					PARTITION BY node_id 
					ORDER BY id DESC
				) AS rank 
			FROM module_jobs
		)
		SELECT 
			n.id,
			COALESCE(d.checked_at, 0),
			COALESCE(d.nginx_version, ''),
			COALESCE(d.architecture, ''),
			COALESCE(d.modules_json, '[]'),
			COALESCE(d.installable, 0),
			COALESCE(d.error, ''),
			COALESCE(j.id, 0),
			COALESCE(j.action, ''),
			COALESCE(j.state, ''),
			COALESCE(j.message, ''),
			COALESCE(j.logs, '')
		FROM cluster_nodes n
		LEFT JOIN node_modules d ON d.node_id = n.id
		LEFT JOIN latest_job j ON j.node_id = n.id AND j.rank = 1
		ORDER BY n.id
	`

	rows, e := r.reader.QueryContext(ctx, query)
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
		var rawMods []struct {
			Name      string `json:"name"`
			Available bool   `json:"available"`
			Loaded    bool   `json:"loaded"`
			Source    string `json:"source"`
		}
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

// QueueJob đưa một tác vụ kiểm tra hoặc cài đặt/gỡ bỏ module vào hàng đợi chờ Node xử lý.
func (r *ModuleStoreRepository) QueueJob(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error) {
	var out entity.QueueModuleJobResult
	now := time.Now().UnixMilli()

	// CTE authority: Kiểm tra tính hợp lệ và điều kiện tiền quyết của node trước khi nhận lệnh:
	// - Node phải tồn tại trong cụm cluster_nodes.
	// - Nếu action là 'check': cho phép chạy bất cứ lúc nào để kiểm tra tính tương thích.
	// - Nếu là lệnh cài đặt/gỡ bỏ: node phải có báo cáo tươi mới (checked_at > now - 90s) và cờ installable = 1.
	// Query chính: Insert tác vụ vào module_jobs với trạng thái 'pending'.
	// ON CONFLICT: Ngăn chặn tạo trùng job nếu node đã có một job đang pending hoặc running.
	const query = `
		WITH authority AS (
			SELECT n.id 
			FROM cluster_nodes n 
			LEFT JOIN node_modules d ON d.node_id = n.id
			WHERE n.id = ? 
			  AND (? = 'check' OR (d.checked_at > ? AND d.installable = 1))
		)
		INSERT INTO module_jobs (
			node_id,
			action,
			state,
			requested_by,
			created_at,
			updated_at
		)
		SELECT 
			id,
			?,
			'pending',
			?,
			?,
			? 
		FROM authority WHERE true
		ON CONFLICT(node_id) WHERE state IN ('pending', 'running') 
		DO UPDATE SET node_id = excluded.node_id
		RETURNING id, action, state
	`

	e := r.writer.QueryRowContext(ctx, query,
		c.NodeID, c.Action, now-90000,
		c.Action, c.Actor, now, now,
	).Scan(&out.ID, &out.Action, &out.State)

	if e == sql.ErrNoRows {
		return out, fmt.Errorf("node unknown, dependency report stale, or compatible Brotli artifact unavailable")
	}
	return out, e
}

// PollJob cho phép node agent lấy job đang chờ theo thứ tự FIFO và chuyển trạng thái sang running.
func (r *ModuleStoreRepository) PollJob(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	var out entity.PollModuleJobResult

	// CTE target: Chọn duy nhất 1 job có ID nhỏ nhất (FIFO) của node đang ở trạng thái 'pending' hoặc 'running'.
	// Query chính: Cập nhật nguyên tử trạng thái job sang 'running' và cập nhật thời gian updated_at.
	const query = `
		WITH target AS (
			SELECT id 
			FROM module_jobs 
			WHERE node_id = ? 
			  AND state IN ('pending', 'running') 
			ORDER BY id ASC 
			LIMIT 1
		)
		UPDATE module_jobs 
		SET state = 'running',
		    updated_at = ? 
		WHERE id IN (SELECT id FROM target) 
		RETURNING id, action
	`

	e := r.writer.QueryRowContext(ctx, query, q.NodeID, time.Now().UnixMilli()).Scan(&out.ID, &out.Action)
	if e == sql.ErrNoRows {
		return out, nil
	}
	return out, e
}

// ReportModules tiếp nhận báo cáo hiện trạng modules của node và cập nhật kết quả kết thúc của job.
func (r *ModuleStoreRepository) ReportModules(ctx context.Context, c entity.ReportModuleCommand) error {
	type reportModuleItem struct {
		Name      string `json:"name"`
		Available bool   `json:"available"`
		Loaded    bool   `json:"loaded"`
		Source    string `json:"source"`
	}
	rawMods := make([]reportModuleItem, len(c.Modules))
	for i, m := range c.Modules {
		rawMods[i] = reportModuleItem{
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

	// CTE authority: Đảm bảo node_id tồn tại hợp lệ trong bảng cluster_nodes.
	// Query chính: Upsert vào node_modules để cập nhật trạng thái kiểm tra mới nhất.
	// Lưu ý cú pháp SQLite: Cần mệnh đề WHERE true để phân định rõ ràng SELECT FROM CTE trước khi sang ON CONFLICT.
	// WHERE excluded.checked_at >= node_modules.checked_at: Bảo vệ idempotency, loại bỏ báo cáo cũ gửi muộn do mạng chập chờn.
	const upsertReportQuery = `
		WITH authority AS (
			SELECT id 
			FROM cluster_nodes 
			WHERE id = ?
		)
		INSERT INTO node_modules (
			node_id,
			checked_at,
			received_at,
			nginx_version,
			architecture,
			modules_json,
			installable,
			error
		)
		SELECT 
			id,
			?,
			?,
			?,
			?,
			?,
			?,
			? 
		FROM authority WHERE true
		ON CONFLICT(node_id) DO UPDATE SET 
			checked_at = excluded.checked_at,
			received_at = excluded.received_at,
			nginx_version = excluded.nginx_version,
			architecture = excluded.architecture,
			modules_json = excluded.modules_json,
			installable = excluded.installable,
			error = excluded.error
		WHERE excluded.checked_at >= node_modules.checked_at
	`

	result, e := tx.ExecContext(ctx, upsertReportQuery,
		c.NodeID, c.CheckedAt, time.Now().UnixMilli(),
		c.NginxVersion, c.Architecture, string(modules),
		c.Installable, c.Error,
	)
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
		e = tx.QueryRowContext(ctx, `SELECT action, state FROM module_jobs WHERE id = ? AND node_id = ?`, c.JobID, c.NodeID).Scan(&action, &state)
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

			// Cập nhật trạng thái hoàn thành (succeeded hoặc failed) kèm message và toàn bộ log tích luỹ
			const updateJobQuery = `
				UPDATE module_jobs 
				SET state = ?,
				    message = ?,
				    logs = CASE WHEN ? != '' THEN ? ELSE logs END,
				    updated_at = ? 
				WHERE id = ? 
				  AND node_id = ? 
				  AND state IN ('pending', 'running')
			`
			_, e = tx.ExecContext(ctx, updateJobQuery,
				c.JobState, c.JobMessage, c.JobLogs, c.JobLogs, time.Now().UnixMilli(), c.JobID, c.NodeID)
			if e != nil {
				return e
			}
		}
	}
	return tx.Commit()
}

// GetJobLogs truy vấn bản ghi log chi tiết và trạng thái của một job theo ID.
func (r *ModuleStoreRepository) GetJobLogs(ctx context.Context, jobID int64) (*entity.ModuleJobLogs, error) {
	const query = `
		SELECT 
			id,
			node_id,
			action,
			state,
			message,
			logs,
			created_at,
			updated_at 
		FROM module_jobs 
		WHERE id = ?
	`

	var logs entity.ModuleJobLogs
	e := r.reader.QueryRowContext(ctx, query, jobID).
		Scan(&logs.ID, &logs.NodeID, &logs.Action, &logs.State, &logs.Message, &logs.Logs, &logs.CreatedAt, &logs.UpdatedAt)
	if e != nil {
		return nil, e
	}
	return &logs, nil
}

// AppendJobLog bổ sung log chunk (realtime streaming) và cập nhật tiến trình cho một tác vụ đang chạy.
func (r *ModuleStoreRepository) AppendJobLog(ctx context.Context, c entity.AppendModuleJobLogCommand) error {
	const query = `
		UPDATE module_jobs
		SET logs = logs || ?,
		    message = CASE WHEN ? != '' THEN ? ELSE message END,
		    updated_at = ?
		WHERE id = ? 
		  AND node_id = ? 
		  AND state IN ('pending', 'running')
	`

	now := time.Now().UnixMilli()
	res, err := r.writer.ExecContext(ctx, query, c.LogChunk, c.Message, c.Message, now, c.JobID, c.NodeID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("active job not found for log appending")
	}
	return nil
}

// SetDesiredState thiết lập cấu hình mong muốn generic toàn hệ thống cho một module.
func (r *ModuleStoreRepository) SetDesiredState(ctx context.Context, c entity.SetModuleDesiredCommand) error {
	now := time.Now().UnixMilli()
	enabledInt := 0
	if c.Enabled {
		enabledInt = 1
	}

	const query = `
		INSERT INTO module_desired_state (name, enabled, updated_at, updated_by)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET 
			enabled = excluded.enabled,
			updated_at = excluded.updated_at,
			updated_by = excluded.updated_by
	`
	_, err := r.writer.ExecContext(ctx, query, c.Name, enabledInt, now, c.Actor)
	return err
}

// GetSyncOverview tính toán đối soát giữa Generic Desired State và Actual State của toàn bộ các NGINX node.
func (r *ModuleStoreRepository) GetSyncOverview(ctx context.Context, q entity.GetModuleSyncOverviewQuery) ([]entity.ModuleSyncItem, error) {
	now := time.Now().UnixMilli()
	freshThreshold := now - 90000

	// CTE desired: Lấy danh sách cấu hình mong muốn generic cho các module hỗ trợ
	// CTE fresh_nodes: Lọc danh sách các node còn kết nối và gửi báo cáo gần nhất
	// Main query: So khớp số node đã nạp thực tế vs số node mong muốn và đếm job đang chờ xử lý
	const query = `
		WITH supported AS (
			SELECT 'brotli' AS name
			UNION
			SELECT name FROM module_desired_state
		),
		desired AS (
			SELECT s.name, COALESCE(d.enabled, 0) AS enabled
			FROM supported s
			LEFT JOIN module_desired_state d ON d.name = s.name
		),

		fresh_nodes AS (
			SELECT n.id, d.modules_json
			FROM cluster_nodes n
			INNER JOIN node_modules d ON d.node_id = n.id
			WHERE d.checked_at > ?
		)
		SELECT 
			d.name,
			d.enabled,
			(SELECT COUNT(*) FROM fresh_nodes) AS total_nodes,
			(
				SELECT COUNT(*)
				FROM fresh_nodes fn, json_each(fn.modules_json) m
				WHERE json_extract(m.value, '$.name') = d.name 
				  AND json_extract(m.value, '$.loaded') = 1
			) AS actual_loaded,
			(
				SELECT COUNT(*) 
				FROM module_jobs j 
				WHERE j.state IN ('pending', 'running') 
				  AND j.action LIKE '%' || d.name
			) AS pending_jobs
		FROM desired d
		ORDER BY d.name
	`

	rows, err := r.reader.QueryContext(ctx, query, freshThreshold)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []entity.ModuleSyncItem
	for rows.Next() {
		var name string
		var enabledInt, totalNodes, actualLoaded, pendingJobs int
		if err := rows.Scan(&name, &enabledInt, &totalNodes, &actualLoaded, &pendingJobs); err != nil {
			return nil, err
		}

		desired := enabledInt == 1
		syncStatus := "Synced"
		featureReady := false

		if pendingJobs > 0 {
			syncStatus = "Progressing"
		} else if totalNodes == 0 {
			if desired {
				syncStatus = "OutOfSync"
			} else {
				syncStatus = "Synced"
			}
		} else if desired {
			if actualLoaded == totalNodes {
				syncStatus = "Synced"
				featureReady = true
			} else {
				syncStatus = "OutOfSync"
			}
		} else {
			if actualLoaded == 0 {
				syncStatus = "Synced"
			} else {
				syncStatus = "OutOfSync"
			}
		}

		items = append(items, entity.ModuleSyncItem{
			Name:         name,
			Desired:      desired,
			ActualLoaded: actualLoaded,
			TotalNodes:   totalNodes,
			SyncStatus:   syncStatus,
			FeatureReady: featureReady,
			PendingJobs:  pendingJobs,
		})
	}
	return items, rows.Err()
}

// FanoutSync fanout đối soát và đưa các job cài đặt/gỡ bỏ vào queue cho toàn bộ các node đang bị lệch (drift).
func (r *ModuleStoreRepository) FanoutSync(ctx context.Context, c entity.TriggerModuleSyncCommand) (entity.TriggerModuleSyncResult, error) {
	now := time.Now().UnixMilli()
	freshThreshold := now - 90000

	targetModule := c.Name
	if targetModule == "" || targetModule == "all" {
		targetModule = "brotli"
	}

	// Lấy desired state generic của targetModule
	var enabledInt int
	err := r.reader.QueryRowContext(ctx, `
		SELECT COALESCE((SELECT enabled FROM module_desired_state WHERE name = ?), 0)
	`, targetModule).Scan(&enabledInt)
	if err != nil {
		return entity.TriggerModuleSyncResult{}, err
	}

	desired := enabledInt == 1
	var action string
	var query string

	if desired {
		action = "install_" + targetModule
		// CTE authority: Tìm các node chưa nạp module này nhưng có thể cài đặt được (installable = 1)
		query = `
			WITH authority AS (
				SELECT n.id
				FROM cluster_nodes n
				INNER JOIN node_modules d ON d.node_id = n.id
				WHERE d.checked_at > ?
				  AND d.installable = 1
				  AND NOT EXISTS (
					  SELECT 1 FROM json_each(d.modules_json) m
					  WHERE json_extract(m.value, '$.name') = ?
					    AND json_extract(m.value, '$.loaded') = 1
				  )
			)
			INSERT INTO module_jobs (node_id, action, state, requested_by, created_at, updated_at)
			SELECT id, ?, 'pending', ?, ?, ?
			FROM authority WHERE true
			ON CONFLICT(node_id) WHERE state IN ('pending', 'running') DO NOTHING
			RETURNING node_id
		`
	} else {
		action = "uninstall_" + targetModule
		// CTE authority: Tìm các node hiện đang nạp module này cần gỡ bỏ
		query = `
			WITH authority AS (
				SELECT n.id
				FROM cluster_nodes n
				INNER JOIN node_modules d ON d.node_id = n.id
				WHERE d.checked_at > ?
				  AND EXISTS (
					  SELECT 1 FROM json_each(d.modules_json) m
					  WHERE json_extract(m.value, '$.name') = ?
					    AND json_extract(m.value, '$.loaded') = 1
				  )
			)
			INSERT INTO module_jobs (node_id, action, state, requested_by, created_at, updated_at)
			SELECT id, ?, 'pending', ?, ?, ?
			FROM authority WHERE true
			ON CONFLICT(node_id) WHERE state IN ('pending', 'running') DO NOTHING
			RETURNING node_id
		`
	}

	rows, err := r.writer.QueryContext(ctx, query, freshThreshold, targetModule, action, c.Actor, now, now)
	if err != nil {
		return entity.TriggerModuleSyncResult{}, err
	}
	defer rows.Close()

	var queuedNodes []string
	for rows.Next() {
		var nid string
		if err := rows.Scan(&nid); err == nil {
			queuedNodes = append(queuedNodes, nid)
		}
	}

	return entity.TriggerModuleSyncResult{
		QueuedJobs: len(queuedNodes),
		NodeIDs:    queuedNodes,
	}, rows.Err()
}
