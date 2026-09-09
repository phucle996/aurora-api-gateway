package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

// sqliteNodeRepository hiện thực NodeRepository interface qua SQLite.
// Áp dụng CTE-first repository: kết hợp bảng cluster_nodes với ruleset_releases
// và node_activation để tính toán trạng thái đồng bộ chính sách (In Sync / Drift)
// ngay trong một câu truy vấn rõ ràng.
type sqliteNodeRepository struct {
	db *sql.DB
}

// NewNodeRepository khởi tạo repository mới cho workflow Cluster Nodes.
func NewNodeRepository(db *sql.DB) repo.NodeRepository {
	return &sqliteNodeRepository{db: db}
}

// ListNodes trả về danh sách tất cả các node đã đăng ký trong cluster.
func (r *sqliteNodeRepository) ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error) {
	// CTE lấy bản phát hành sẵn sàng mới nhất (latest_rule_release, latest_policy_release) và thông tin kích hoạt
	// để tự động tính toán trạng thái sync_status (In Sync nếu trùng release mới nhất, Drift nếu bị lệch)
	query := `
	WITH latest_rule_release AS (
		SELECT id
		FROM ruleset_releases
		WHERE state = 'ready'
		ORDER BY id DESC
		LIMIT 1
	),
	latest_policy_release AS (
		SELECT release_id AS id
		FROM policy_cluster_head
		WHERE singleton = 1
	),
	active_node_journal AS (
		SELECT release_id, phase, updated_at
		FROM node_activation
		WHERE singleton = 1
	)
	SELECT 
		n.id,
		n.name,
		n.hostname,
		n.ip,
		n.status,
		n.version,
		COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id) AS active_release_id,
		CASE WHEN COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id, 0) > 0 THEN 'rev-' || COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id) ELSE 'none' END AS ruleset,
		CASE 
			WHEN lpr.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END) = lpr.id THEN 'In Sync' ELSE 'Drift' END
			WHEN lrr.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, n.active_release_id) = lrr.id THEN 'In Sync' ELSE 'Drift' END
			ELSE 'In Sync'
		END AS computed_sync,
		n.join_method,
		n.certificate,
		CASE WHEN n.observed_release_id IS NOT NULL THEN n.last_heartbeat ELSE '' END,
		n.created_at,
		n.last_applied_at AS last_sync_time,
		n.pending_command,
		n.reload_status, n.runtime_started_at, n.metrics_scope, n.worker_identity
	FROM cluster_nodes n
	LEFT JOIN latest_rule_release lrr ON 1=1
	LEFT JOIN latest_policy_release lpr ON 1=1
	LEFT JOIN active_node_journal j ON 1=1
	LEFT JOIN policy_node_reports pnr ON pnr.node_id = n.id
	ORDER BY n.name ASC;`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("truy vấn danh sách nodes thất bại: %w", err)
	}
	defer rows.Close()

	var nodes []entity.ClusterNodeRecord
	for rows.Next() {
		var item entity.ClusterNodeRecord
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Hostname,
			&item.IP,
			&item.Status,
			&item.Version,
			&item.ActiveReleaseID,
			&item.Ruleset,
			&item.SyncStatus,
			&item.JoinMethod,
			&item.Certificate,
			&item.LastHeartbeat,
			&item.CreatedAt,
			&item.LastSyncTime,
			&item.PendingCommand,
			&item.ReloadStatus, &item.RuntimeStartedAt, &item.MetricsScope, &item.WorkerIdentity,
		); err != nil {
			return nil, fmt.Errorf("quét bản ghi node thất bại: %w", err)
		}
		switch item.SyncStatus {
		case "Drift":
			item.PolicySync = "Drift Detected"
		case "Syncing":
			item.PolicySync = "Syncing"
		default:
			item.PolicySync = "Synchronized"
		}
		nodes = append(nodes, item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lỗi trong quá trình duyệt kết quả nodes: %w", err)
	}

	if nodes == nil {
		nodes = []entity.ClusterNodeRecord{}
	}
	return nodes, nil
}

// GetNodeByID lấy chi tiết một node cụ thể theo ID.
func (r *sqliteNodeRepository) GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error) {
	query := `
	WITH latest_rule_release AS (
		SELECT id
		FROM ruleset_releases
		WHERE state = 'ready'
		ORDER BY id DESC
		LIMIT 1
	),
	latest_policy_release AS (
		SELECT release_id AS id
		FROM policy_cluster_head
		WHERE singleton = 1
	),
	active_node_journal AS (
		SELECT release_id, phase, updated_at
		FROM node_activation
		WHERE singleton = 1
	)
	SELECT 
		n.id,
		n.name,
		n.hostname,
		n.ip,
		n.status,
		n.version,
		COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id) AS active_release_id,
		CASE WHEN COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id, 0) > 0 THEN 'rev-' || COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END, n.active_release_id) ELSE 'none' END AS ruleset,
		CASE 
			WHEN lpr.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, CASE WHEN pnr.phase = 'observed' THEN pnr.release_id END) = lpr.id THEN 'In Sync' ELSE 'Drift' END
			WHEN lrr.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, n.active_release_id) = lrr.id THEN 'In Sync' ELSE 'Drift' END
			ELSE 'In Sync'
		END AS computed_sync,
		n.join_method,
		n.certificate,
		CASE WHEN n.observed_release_id IS NOT NULL THEN n.last_heartbeat ELSE '' END,
		n.created_at,
		n.last_applied_at AS last_sync_time,
		n.pending_command,
		n.reload_status, n.runtime_started_at, n.metrics_scope, n.worker_identity
	FROM cluster_nodes n
	LEFT JOIN latest_rule_release lrr ON 1=1
	LEFT JOIN latest_policy_release lpr ON 1=1
	LEFT JOIN active_node_journal j ON 1=1
	LEFT JOIN policy_node_reports pnr ON pnr.node_id = n.id
	WHERE n.id = ?
	LIMIT 1;`

	var item entity.ClusterNodeRecord
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Name,
		&item.Hostname,
		&item.IP,
		&item.Status,
		&item.Version,
		&item.ActiveReleaseID,
		&item.Ruleset,
		&item.SyncStatus,
		&item.JoinMethod,
		&item.Certificate,
		&item.LastHeartbeat,
		&item.CreatedAt,
		&item.LastSyncTime,
		&item.PendingCommand,
		&item.ReloadStatus, &item.RuntimeStartedAt, &item.MetricsScope, &item.WorkerIdentity,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("truy vấn node %s thất bại: %w", id, err)
	}
	switch item.SyncStatus {
	case "Drift":
		item.PolicySync = "Drift Detected"
	case "Syncing":
		item.PolicySync = "Syncing"
	default:
		item.PolicySync = "Synchronized"
	}
	return &item, nil
}

// UpdateHeartbeat cập nhật thời điểm heartbeat và trạng thái liveness mới nhất của node.
// Tự động ghi danh (auto-register) node mới vào cluster nếu node chưa từng tồn tại.
func (r *sqliteNodeRepository) UpdateHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) error {
	deployment := "Unknown"
	switch payload.MetricsScope {
	case "container":
		deployment = "Docker Container"
	case "host":
		deployment = "Systemd Service"
	}
	auth := payload.Authentication
	if auth == "" {
		auth = "Unknown"
	}
	query := `
    INSERT INTO cluster_nodes
      (id,name,hostname,ip,status,version,sync_status,join_method,certificate,last_heartbeat,created_at,
       observed_release_id,runtime_started_at,worker_identity,metrics_scope,last_applied_at)
    VALUES (?,?,?,?,'Ready',?,'Syncing',?,?,datetime(?,'unixepoch'),datetime(?,'unixepoch'),?,?,?,?,
            CASE WHEN ? > 0 THEN datetime(?,'unixepoch') ELSE '' END)
    ON CONFLICT(id) DO UPDATE SET
      hostname=excluded.hostname, ip=CASE WHEN excluded.ip != '' THEN excluded.ip ELSE cluster_nodes.ip END,
      version=excluded.version, join_method=excluded.join_method, certificate=excluded.certificate,
      last_heartbeat=excluded.last_heartbeat,status='Ready',
      last_applied_at=CASE WHEN excluded.observed_release_id > 0 AND (cluster_nodes.observed_release_id IS NULL OR cluster_nodes.observed_release_id != excluded.observed_release_id) THEN excluded.last_heartbeat ELSE cluster_nodes.last_applied_at END,
      observed_release_id=excluded.observed_release_id,
      reload_status=CASE WHEN cluster_nodes.reload_status='reloading' AND cluster_nodes.worker_identity != '' AND excluded.worker_identity != '' AND cluster_nodes.worker_identity != excluded.worker_identity THEN 'completed' ELSE cluster_nodes.reload_status END,
      runtime_started_at=excluded.runtime_started_at, worker_identity=excluded.worker_identity,metrics_scope=excluded.metrics_scope
    WHERE cluster_nodes.observed_release_id IS NULL OR unixepoch(excluded.last_heartbeat) > unixepoch(cluster_nodes.last_heartbeat);`
	_, err := r.db.ExecContext(ctx, query, payload.NodeID, payload.NodeID, payload.Hostname, payload.IP, payload.Version,
		deployment, auth, payload.Timestamp, payload.Timestamp, payload.ActiveReleaseID, payload.RuntimeStartedAt, payload.WorkerIdentity, payload.MetricsScope, payload.ActiveReleaseID, payload.Timestamp)
	return err
}

// SetNodeCommand đặt lệnh điều khiển chờ thực thi cho một node.
func (r *sqliteNodeRepository) SetNodeCommand(ctx context.Context, nodeID string, cmd string, reloadStatus string) error {
	query := `
	UPDATE cluster_nodes
	SET pending_command = ?, reload_status = ?
	WHERE id = ?;`

	res, err := r.db.ExecContext(ctx, query, cmd, reloadStatus, nodeID)
	if err != nil {
		return fmt.Errorf("đặt lệnh cho node %s thất bại: %w", nodeID, err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("không tìm thấy node %s", nodeID)
	}
	return nil
}

// GetNodeCommandAndLatestRelease lấy chỉ thị lệnh và bản release mới nhất cho node, đồng thời chuyển trạng thái.
func (r *sqliteNodeRepository) GetNodeCommandAndLatestRelease(ctx context.Context, nodeID string) (string, int64, error) {
	query := `
	WITH latest_release AS (
		SELECT id
		FROM ruleset_releases
		WHERE state = 'ready'
		ORDER BY id DESC
		LIMIT 1
	)
	SELECT 
		n.pending_command,
		COALESCE((SELECT release_id FROM policy_cluster_head WHERE singleton=1), lr.id, 0)
	FROM cluster_nodes n
	LEFT JOIN latest_release lr ON 1=1
	WHERE n.id = ?;`

	var cmd string
	var desiredRelease int64
	err := r.db.QueryRowContext(ctx, query, nodeID).Scan(&cmd, &desiredRelease)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "none", 0, nil
		}
		return "none", 0, err
	}

	// Nếu có lệnh pending, xóa pending_command và chuyển reload_status sang 'reloading'
	if cmd != "" && cmd != "none" {
		_, _ = r.db.ExecContext(ctx, `
			UPDATE cluster_nodes 
			SET pending_command = 'none', 
			    reload_status = CASE WHEN pending_command = 'reload_process' THEN 'reloading' ELSE reload_status END
			WHERE id = ?;
		`, nodeID)
	}

	return cmd, desiredRelease, nil
}

// SetRollingReload thiết lập quy trình rolling reload tuần tự.
func (r *sqliteNodeRepository) SetRollingReload(ctx context.Context, nodeIDs []string) error {
	if len(nodeIDs) == 0 {
		return nil
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Đưa tất cả các node trong danh sách về trạng thái 'pending'
	for i, id := range nodeIDs {
		cmd := "none"
		reloadStatus := "pending"
		// Node đầu tiên lập tức nhận lệnh reload_process
		if i == 0 {
			cmd = "reload_process"
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE cluster_nodes
			SET pending_command = ?, reload_status = ?
			WHERE id = ?;
		`, cmd, reloadStatus, id)
		if err != nil {
			return fmt.Errorf("cập nhật trạng thái rolling node %s thất bại: %w", id, err)
		}
	}

	return tx.Commit()
}

// GetRollingNodesStatus trả về danh sách các node ID theo từng trạng thái rolling.
func (r *sqliteNodeRepository) GetRollingNodesStatus(ctx context.Context) (pending []string, reloading []string, completed []string, err error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, reload_status 
		FROM cluster_nodes 
		WHERE reload_status IN ('pending', 'reloading', 'completed')
		ORDER BY name ASC;
	`)
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, nil, nil, err
		}
		switch status {
		case "pending":
			pending = append(pending, id)
		case "reloading":
			reloading = append(reloading, id)
		case "completed":
			completed = append(completed, id)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}
	return pending, reloading, completed, nil
}

// BatchInsertMetricsHistory ghi gom cụm (batch) các điểm đo rollup vào bảng node_metrics_history.
func (r *sqliteNodeRepository) BatchInsertMetricsHistory(ctx context.Context, records []entity.NodeMetricHistoryRecord) error {
	if len(records) == 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT OR REPLACE INTO node_metrics_history 
		(node_id, timestamp, cpu_usage, memory_usage, active_connections, requests_per_second, metrics_scope)
		VALUES (?, ?, ?, ?, ?, ?, ?);
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, rec := range records {
		if _, err := stmt.ExecContext(ctx, rec.NodeID, rec.Timestamp, rec.CPUUsage, rec.MemoryUsage, rec.ActiveConnections, rec.RequestsPerSecond, rec.MetricsScope); err != nil {
			return fmt.Errorf("lưu batch metric history cho node %s thất bại: %w", rec.NodeID, err)
		}
	}

	return tx.Commit()
}

// CleanupExpiredMetricsHistory tự động dọn dẹp các bản ghi metrics cũ quá số ngày retentionDays (mặc định 7 ngày).
// Thực hiện xóa theo từng batch nhỏ (500 bản ghi/mẻ) kết hợp pacing (nghỉ 30ms giữa các mẻ)
// nhằm giải phóng write lock cho SQLite, tránh gây nghẽn database hoặc tăng đột biến kích thước WAL.
func (r *sqliteNodeRepository) CleanupExpiredMetricsHistory(ctx context.Context, retentionDays int) error {
	if retentionDays <= 0 {
		retentionDays = 7
	}
	modifier := fmt.Sprintf("-%d days", retentionDays)
	batchSize := 500

	query := `
	DELETE FROM node_metrics_history
	WHERE rowid IN (
		SELECT rowid
		FROM node_metrics_history
		WHERE timestamp < strftime('%s', 'now', ?)
		LIMIT ?
	);`

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		res, err := r.db.ExecContext(ctx, query, modifier, batchSize)
		if err != nil {
			return fmt.Errorf("dọn dẹp batch metrics history hết hạn thất bại: %w", err)
		}

		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}

		// Nếu không còn dòng nào hết hạn hoặc mẻ vừa xóa ít hơn batchSize -> đã dọn sạch toàn bộ
		if rows == 0 || rows < int64(batchSize) {
			break
		}

		// Pacing: nhường write lock cho các workflow khác (như ghi metrics hoặc update rule)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(30 * time.Millisecond):
		}
	}

	return nil
}

// GetRecentMetricsHistory lấy tối đa limit bản ghi lịch sử gần nhất và sắp xếp theo thời gian tăng dần.
func (r *sqliteNodeRepository) GetRecentMetricsHistory(ctx context.Context, nodeID string, limit int) ([]entity.NodeMetricPoint, error) {
	if limit <= 0 {
		limit = 60
	}
	query := `
	WITH recent AS (
		SELECT timestamp, cpu_usage, memory_usage, active_connections, requests_per_second, metrics_scope
		FROM node_metrics_history
		WHERE node_id = ? AND timestamp >= unixepoch('now') - 3600 AND timestamp <= unixepoch('now')
		ORDER BY timestamp DESC
		LIMIT ?
	)
	SELECT timestamp, cpu_usage, memory_usage, active_connections, requests_per_second, metrics_scope
	FROM recent
	ORDER BY timestamp ASC;`

	rows, err := r.db.QueryContext(ctx, query, nodeID, limit)
	if err != nil {
		return nil, fmt.Errorf("truy vấn lịch sử metrics node %s thất bại: %w", nodeID, err)
	}
	defer rows.Close()

	var points []entity.NodeMetricPoint
	now := time.Now().Unix()
	for rows.Next() {
		var p entity.NodeMetricPoint
		if err := rows.Scan(&p.Timestamp, &p.CPUUsage, &p.MemoryUsage, &p.ActiveConnections, &p.RPS, &p.MetricsScope); err != nil {
			return nil, fmt.Errorf("quét bản ghi lịch sử metric thất bại: %w", err)
		}
		minutesAgo := int(float64(now-p.Timestamp) / 60.0)
		p.TimeLabel = fmt.Sprintf("-%dm", minutesAgo)
		if minutesAgo <= 0 {
			p.TimeLabel = "Now"
		}
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lỗi trong quá trình đọc lịch sử metrics: %w", err)
	}
	if points == nil {
		points = []entity.NodeMetricPoint{}
	}
	return points, nil
}

// InsertSyncLog lưu lại sự kiện đồng bộ thực tế của node vào bảng node_sync_logs.
func (r *sqliteNodeRepository) InsertSyncLog(ctx context.Context, nodeID string, eventType string, releaseID *int64, message string) (*entity.NodeSyncLogRecord, error) {
	query := `
	INSERT INTO node_sync_logs (node_id, event_type, release_id, message, created_at)
	VALUES (?, ?, ?, ?, datetime('now'))
	RETURNING id, node_id, event_type, release_id, message, created_at;`

	var rec entity.NodeSyncLogRecord
	err := r.db.QueryRowContext(ctx, query, nodeID, eventType, releaseID, message).
		Scan(&rec.ID, &rec.NodeID, &rec.EventType, &rec.ReleaseID, &rec.Message, &rec.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("InsertSyncLog node %s: %w", nodeID, err)
	}
	return &rec, nil
}

// ListNodeSyncLogs truy vấn danh sách log đồng bộ của một node theo thứ tự mới nhất trước.
func (r *sqliteNodeRepository) ListNodeSyncLogs(ctx context.Context, nodeID string, limit int) ([]entity.NodeSyncLogRecord, error) {
	if limit <= 0 {
		limit = 30
	}
	query := `
	SELECT id, node_id, event_type, release_id, message, created_at
	FROM node_sync_logs
	WHERE node_id = ?
	ORDER BY id DESC
	LIMIT ?;`

	rows, err := r.db.QueryContext(ctx, query, nodeID, limit)
	if err != nil {
		return nil, fmt.Errorf("ListNodeSyncLogs node %s: %w", nodeID, err)
	}
	defer rows.Close()

	var logs []entity.NodeSyncLogRecord
	for rows.Next() {
		var l entity.NodeSyncLogRecord
		if err := rows.Scan(&l.ID, &l.NodeID, &l.EventType, &l.ReleaseID, &l.Message, &l.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan NodeSyncLogRecord: %w", err)
		}
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if logs == nil {
		logs = []entity.NodeSyncLogRecord{}
	}
	return logs, nil
}

func (r *sqliteNodeRepository) GetHeartbeatState(ctx context.Context, nodeID string) (*entity.NodeHeartbeatState, error) {
	var state entity.NodeHeartbeatState
	err := r.db.QueryRowContext(ctx, `SELECT observed_release_id, CASE WHEN observed_release_id IS NULL THEN 0 ELSE COALESCE(unixepoch(last_heartbeat),0) END, reload_status,worker_identity FROM cluster_nodes WHERE id=?`, nodeID).Scan(&state.ActiveReleaseID, &state.Timestamp, &state.ReloadStatus, &state.WorkerIdentity)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &state, err
}

func (r *sqliteNodeRepository) EnsureNodeExists(ctx context.Context, nodeID, ip, hostname string) error {
	if nodeID == "" {
		return nil
	}
	query := `INSERT INTO cluster_nodes (id, name, hostname, ip, status, version, sync_status, join_method, certificate, last_heartbeat, created_at)
		VALUES (?, ?, ?, ?, 'Ready', '0.4.1', 'In Sync', 'gRPC Sync', 'None', datetime('now'), datetime('now'))
		ON CONFLICT(id) DO NOTHING;`
	_, err := r.db.ExecContext(ctx, query, nodeID, nodeID, hostname, ip)
	return err
}
