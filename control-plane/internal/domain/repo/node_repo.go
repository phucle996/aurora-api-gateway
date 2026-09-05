package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// NodeRepository định nghĩa port truy xuất dữ liệu của workflow Cluster Nodes.
// Áp dụng kiến trúc phẳng (Flat workflow): Chỉ trả về flat projection của chính workflow này.
type NodeRepository interface {
	ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error)
	GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error)
	UpdateHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) error
	BatchInsertMetricsHistory(ctx context.Context, records []entity.NodeMetricHistoryRecord) error
	CleanupExpiredMetricsHistory(ctx context.Context, retentionDays int) error
	GetRecentMetricsHistory(ctx context.Context, nodeID string, limit int) ([]entity.NodeMetricPoint, error)
	SetNodeCommand(ctx context.Context, nodeID string, cmd string, reloadStatus string) error
	GetNodeCommandAndLatestRelease(ctx context.Context, nodeID string) (string, int64, error)
	SetClusterRollingReload(ctx context.Context, nodeIDs []string) error
	GetRollingNodesStatus(ctx context.Context) (pending []string, reloading []string, completed []string, err error)
}
