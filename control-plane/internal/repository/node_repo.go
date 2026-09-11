package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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
	// CTE lấy bản phát hành cluster spec mới nhất để tự động tính toán trạng thái sync_status
	query := `
	WITH latest_cluster_spec AS (
		SELECT release_id AS id
		FROM cluster_spec_head
		WHERE singleton = 1
	)
	SELECT 
		n.id,
		n.name,
		n.hostname,
		n.ip,
		n.status,
		n.version,
		n.observed_release_id AS active_release_id,
		CASE WHEN COALESCE(n.observed_release_id, 0) > 0 THEN 'rev-' || n.observed_release_id ELSE 'none' END AS ruleset,
		CASE 
			WHEN lcs.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, 0) = lcs.id THEN 'In Sync' ELSE 'Drift' END
			ELSE 'In Sync'
		END AS computed_sync,
		n.join_method,
		n.certificate,
		CASE WHEN n.observed_release_id IS NOT NULL THEN n.last_heartbeat ELSE '' END,
		n.created_at,
		n.last_applied_at AS last_sync_time,
		n.pending_command,
		n.reload_status, n.runtime_started_at, n.worker_identity
	FROM cluster_nodes n
	LEFT JOIN latest_cluster_spec lcs ON 1=1
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
			&item.ReloadStatus, &item.RuntimeStartedAt, &item.WorkerIdentity,
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
	WITH latest_cluster_spec AS (
		SELECT release_id AS id
		FROM cluster_spec_head
		WHERE singleton = 1
	)
	SELECT 
		n.id,
		n.name,
		n.hostname,
		n.ip,
		n.status,
		n.version,
		n.observed_release_id AS active_release_id,
		CASE WHEN COALESCE(n.observed_release_id, 0) > 0 THEN 'rev-' || n.observed_release_id ELSE 'none' END AS ruleset,
		CASE 
			WHEN lcs.id IS NOT NULL THEN
				CASE WHEN COALESCE(n.observed_release_id, 0) = lcs.id THEN 'In Sync' ELSE 'Drift' END
			ELSE 'In Sync'
		END AS computed_sync,
		n.join_method,
		n.certificate,
		CASE WHEN n.observed_release_id IS NOT NULL THEN n.last_heartbeat ELSE '' END,
		n.created_at,
		n.last_applied_at AS last_sync_time,
		n.pending_command,
		n.reload_status, n.runtime_started_at, n.worker_identity
	FROM cluster_nodes n
	LEFT JOIN latest_cluster_spec lcs ON 1=1
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
		&item.ReloadStatus, &item.RuntimeStartedAt, &item.WorkerIdentity,
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
	SELECT 
		n.pending_command,
		COALESCE((SELECT release_id FROM cluster_spec_head WHERE singleton=1), 0)
	FROM cluster_nodes n
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

func (r *sqliteNodeRepository) EnsureNodeExists(ctx context.Context, nodeID, ip, hostname string) error {
	if nodeID == "" {
		return nil
	}
	query := `INSERT INTO cluster_nodes (id, name, hostname, ip, status, version, sync_status, join_method, certificate, last_heartbeat, created_at)
		VALUES (?, ?, ?, ?, 'Ready', 'active', 'In Sync', 'gRPC Sync', 'Valid', datetime('now'), datetime('now'))
		ON CONFLICT(id) DO NOTHING;`
	_, err := r.db.ExecContext(ctx, query, nodeID, nodeID, hostname, ip)
	return err
}

func (r *sqliteNodeRepository) DeleteNode(ctx context.Context, id string) error {
	if id == "" {
		return nil
	}
	query := `DELETE FROM cluster_nodes WHERE id = ?;`
	_, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete node %s: %w", id, err)
	}
	return nil
}
