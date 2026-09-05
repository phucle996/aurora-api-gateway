package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// NodeService định nghĩa port nghiệp vụ của workflow quản lý Cluster Nodes.
type NodeService interface {
	ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error)
	GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error)
	GetNodeConfig(ctx context.Context, nodeID string) (string, error)
	RecordHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) (*entity.NodeCommandDirective, error)
	TriggerNodeReload(ctx context.Context, nodeID string) error
	TriggerClusterRollingReload(ctx context.Context) (*entity.ClusterRollingStatus, error)
	GetClusterRollingStatus(ctx context.Context) (*entity.ClusterRollingStatus, error)
	ListNodeSyncLogs(ctx context.Context, nodeID string, limit int) ([]entity.NodeSyncLogRecord, error)
	SubscribeEvents() (<-chan entity.SSEMessage, func())
}
