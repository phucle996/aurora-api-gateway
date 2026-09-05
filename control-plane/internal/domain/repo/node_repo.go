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
}
