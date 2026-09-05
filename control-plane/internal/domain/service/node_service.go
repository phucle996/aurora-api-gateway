package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

// NodeService định nghĩa port nghiệp vụ của workflow quản lý Cluster Nodes.
type NodeService interface {
	ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error)
	GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error)
	RecordHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) error
}
