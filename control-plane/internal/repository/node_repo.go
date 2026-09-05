package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"database/sql"
	"errors"
	"fmt"
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
		COALESCE(j.updated_at, n.last_heartbeat) AS last_sync_time
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
		COALESCE(j.updated_at, n.last_heartbeat) AS last_sync_time
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
