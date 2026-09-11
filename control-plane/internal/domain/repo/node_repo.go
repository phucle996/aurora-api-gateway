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
	SetNodeCommand(ctx context.Context, nodeID string, cmd string, reloadStatus string) error
	GetNodeCommandAndLatestRelease(ctx context.Context, nodeID string) (string, int64, error)
	SetRollingReload(ctx context.Context, nodeIDs []string) error
	GetRollingNodesStatus(ctx context.Context) (pending []string, reloading []string, completed []string, err error)
	InsertSyncLog(ctx context.Context, nodeID string, eventType string, releaseID *int64, message string) (*entity.NodeSyncLogRecord, error)
	ListNodeSyncLogs(ctx context.Context, nodeID string, limit int) ([]entity.NodeSyncLogRecord, error)
	EnsureNodeExists(ctx context.Context, nodeID, ip, hostname string) error
	DeleteNode(ctx context.Context, id string) error
}
