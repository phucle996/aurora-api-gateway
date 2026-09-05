package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
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
	// CTE lấy bản phát hành sẵn sàng mới nhất (latest_release) và thông tin kích hoạt (active_node_journal)
	// để tự động tính toán trạng thái sync_status (In Sync nếu trùng release mới nhất, Drift nếu bị lệch)
	query := `
	WITH latest_release AS (
		SELECT id
		FROM ruleset_releases
		WHERE state = 'ready'
		ORDER BY id DESC
		LIMIT 1
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
		n.role,
		n.status,
		n.version,
		n.active_release_id,
		COALESCE('rev-' || n.active_release_id, 'none') AS ruleset,
		CASE 
			WHEN n.active_release_id IS NULL THEN 'Syncing'
			WHEN lr.id IS NOT NULL AND n.active_release_id = lr.id THEN 'In Sync'
			WHEN lr.id IS NOT NULL AND n.active_release_id != lr.id THEN 'Drift'
			ELSE n.sync_status
		END AS computed_sync,
		n.join_method,
		n.certificate,
		n.last_heartbeat,
		n.created_at,
		COALESCE(j.updated_at, n.last_heartbeat) AS last_sync_time,
		n.pending_command,
		n.reload_status
	FROM cluster_nodes n
	LEFT JOIN latest_release lr ON 1=1
	LEFT JOIN active_node_journal j ON 1=1
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
			&item.Role,
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
			&item.ReloadStatus,
		); err != nil {
			return nil, fmt.Errorf("quét bản ghi node thất bại: %w", err)
		}
		item.PolicySync = "Successful"
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
	WITH latest_release AS (
		SELECT id
		FROM ruleset_releases
		WHERE state = 'ready'
		ORDER BY id DESC
		LIMIT 1
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
		n.role,
		n.status,
		n.version,
		n.active_release_id,
		COALESCE('rev-' || n.active_release_id, 'none') AS ruleset,
		CASE 
			WHEN n.active_release_id IS NULL THEN 'Syncing'
			WHEN lr.id IS NOT NULL AND n.active_release_id = lr.id THEN 'In Sync'
			WHEN lr.id IS NOT NULL AND n.active_release_id != lr.id THEN 'Drift'
			ELSE n.sync_status
		END AS computed_sync,
		n.join_method,
		n.certificate,
		n.last_heartbeat,
		n.created_at,
		COALESCE(j.updated_at, n.last_heartbeat) AS last_sync_time,
		n.pending_command,
		n.reload_status
	FROM cluster_nodes n
	LEFT JOIN latest_release lr ON 1=1
	LEFT JOIN active_node_journal j ON 1=1
	WHERE n.id = ?
	LIMIT 1;`

	var item entity.ClusterNodeRecord
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Name,
		&item.Hostname,
		&item.IP,
		&item.Role,
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
		&item.ReloadStatus,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("truy vấn node %s thất bại: %w", id, err)
	}
	item.PolicySync = "Successful"
	return &item, nil
}

// UpdateHeartbeat cập nhật thời điểm heartbeat và trạng thái liveness mới nhất của node.
func (r *sqliteNodeRepository) UpdateHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) error {
	query := `
	UPDATE cluster_nodes
	SET 
		last_heartbeat = datetime(?, 'unixepoch'),
		status = 'Ready',
		reload_status = CASE 
			WHEN reload_status = 'reloading' THEN 'completed'
			ELSE reload_status
		END,
		active_release_id = CASE 
			WHEN ? > 0 AND EXISTS(SELECT 1 FROM ruleset_releases WHERE id = ?) THEN ? 
			ELSE active_release_id 
		END
	WHERE id = ?;`

	res, err := r.db.ExecContext(ctx, query, payload.Timestamp, payload.ActiveReleaseID, payload.ActiveReleaseID, payload.ActiveReleaseID, payload.NodeID)
	if err != nil {
		return fmt.Errorf("cập nhật heartbeat node %s thất bại: %w", payload.NodeID, err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("không tìm thấy node %s để cập nhật heartbeat", payload.NodeID)
	}
	return nil
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
		COALESCE(lr.id, 0)
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

// SetClusterRollingReload thiết lập quy trình rolling reload toàn cụm.
func (r *sqliteNodeRepository) SetClusterRollingReload(ctx context.Context, nodeIDs []string) error {
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
		(node_id, timestamp, cpu_usage, memory_usage, active_connections, requests_per_second)
		VALUES (?, ?, ?, ?, ?, ?);
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, rec := range records {
		if _, err := stmt.ExecContext(ctx, rec.NodeID, rec.Timestamp, rec.CPUUsage, rec.MemoryUsage, rec.ActiveConnections, rec.RequestsPerSecond); err != nil {
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
		SELECT timestamp, cpu_usage, memory_usage, active_connections, requests_per_second
		FROM node_metrics_history
		WHERE node_id = ?
		ORDER BY timestamp DESC
		LIMIT ?
	)
	SELECT timestamp, cpu_usage, memory_usage, active_connections, requests_per_second
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
		if err := rows.Scan(&p.Timestamp, &p.CPUUsage, &p.MemoryUsage, &p.ActiveConnections, &p.RPS); err != nil {
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


