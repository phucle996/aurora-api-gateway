package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"fmt"
	"time"
)

type nodeService struct {
	repo repo.NodeRepository
}

// NewNodeService khởi tạo service quản lý workflow Cluster Nodes.
func NewNodeService(repo repo.NodeRepository) domainService.NodeService {
	return &nodeService{repo: repo}
}

// ListNodes lấy danh sách tất cả các node từ repository và định dạng thời gian heartbeat.
// Thiết kế thuần nhất (Uniform Node Handling): Đối xử với mọi node bình đẳng theo đúng
// dữ liệu trạng thái từ database, không hardcode logic cục bộ hay đọc file riêng lẻ.
func (s *nodeService) ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error) {
	// 1. Truy vấn danh sách node từ repository
	nodes, err := s.repo.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("nodeService.ListNodes: %w", err)
	}

	// 2. Chuẩn hóa hiển thị thời gian tương đối cho LastHeartbeat
	now := time.Now().UTC()
	for i := range nodes {
		if t, err := time.Parse(time.RFC3339, nodes[i].LastHeartbeat); err == nil {
			diff := now.Sub(t)
			if diff < time.Minute {
				nodes[i].LastHeartbeat = fmt.Sprintf("%ds ago", int(diff.Seconds()))
			} else if diff < time.Hour {
				nodes[i].LastHeartbeat = fmt.Sprintf("%dm ago", int(diff.Minutes()))
			} else {
				nodes[i].LastHeartbeat = fmt.Sprintf("%dh ago", int(diff.Hours()))
			}
		}

		// Khởi tạo các trường hiển thị mặc định thống nhất cho toàn bộ các node
		nodes[i].ActiveConnections = "0"
		nodes[i].RequestsPerSecond = "0"
		nodes[i].Uptime = "Active"
	}

	return nodes, nil
}

// GetNodeByID lấy thông tin chi tiết của một node cụ thể theo ID.
func (s *nodeService) GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error) {
	node, err := s.repo.GetNodeByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("nodeService.GetNodeByID: %w", err)
	}
	if node == nil {
		return nil, nil
	}

	node.ActiveConnections = "0"
	node.RequestsPerSecond = "0"
	node.Uptime = "Active"
	return node, nil
}
