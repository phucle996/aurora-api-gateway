package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"errors"
	"fmt"
	"time"
)

type nodeService struct {
	repo       repo.NodeRepository
	metricsSvc domainService.MetricsService
}

// NewNodeService khởi tạo service quản lý workflow Cluster Nodes.
func NewNodeService(repo repo.NodeRepository, metricsSvc domainService.MetricsService) domainService.NodeService {
	return &nodeService{
		repo:       repo,
		metricsSvc: metricsSvc,
	}
}

// ListNodes lấy danh sách tất cả các node từ repository và định dạng thời gian heartbeat.
func (s *nodeService) ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error) {
	// 1. Truy vấn danh sách node từ repository
	nodes, err := s.repo.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("nodeService.ListNodes: %w", err)
	}

	// 2. Chuẩn hóa hiển thị thời gian tương đối cho LastHeartbeat và trạng thái liveness
	now := time.Now().UTC()
	for i := range nodes {
		node := &nodes[i]
		if t, err := time.Parse(time.RFC3339, node.LastHeartbeat); err == nil {
			diff := now.Sub(t)
			if diff < time.Minute {
				node.LastHeartbeat = fmt.Sprintf("%ds ago", int(diff.Seconds()))
			} else if diff < time.Hour {
				node.LastHeartbeat = fmt.Sprintf("%dm ago", int(diff.Minutes()))
			} else {
				node.LastHeartbeat = fmt.Sprintf("%dh ago", int(diff.Hours()))
			}

			if diff > 45*time.Second {
				node.Status = "Not Ready"
				node.Uptime = "Offline"
			} else {
				node.Status = "Ready"
				node.Uptime = "Active"
			}
		}

		// Nạp dữ liệu đo đạc thực tế từ In-Memory Ring Buffer thay vì gán tĩnh
		if s.metricsSvc != nil {
			if pt := s.metricsSvc.GetLatestMetricPoint(node.ID); pt != nil {
				node.CPUUsage = pt.CPUUsage
				node.MemoryUsage = pt.MemoryUsage
				node.ActiveConnections = fmt.Sprintf("%d", pt.ActiveConnections)
				node.RequestsPerSecond = fmt.Sprintf("%.1f", pt.RPS)
			} else {
				node.ActiveConnections = "0"
				node.RequestsPerSecond = "0"
			}
		} else {
			node.ActiveConnections = "0"
			node.RequestsPerSecond = "0"
		}
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

	now := time.Now().UTC()
	if t, err := time.Parse(time.RFC3339, node.LastHeartbeat); err == nil {
		diff := now.Sub(t)
		if diff < time.Minute {
			node.LastHeartbeat = fmt.Sprintf("%ds ago", int(diff.Seconds()))
		} else if diff < time.Hour {
			node.LastHeartbeat = fmt.Sprintf("%dm ago", int(diff.Minutes()))
		} else {
			node.LastHeartbeat = fmt.Sprintf("%dh ago", int(diff.Hours()))
		}

		if diff > 45*time.Second {
			node.Status = "Not Ready"
			node.Uptime = "Offline"
		} else {
			node.Status = "Ready"
			node.Uptime = "Active"
		}
	}

	// Nạp dữ liệu đo đạc thực tế từ In-Memory Ring Buffer
	if s.metricsSvc != nil {
		if pt := s.metricsSvc.GetLatestMetricPoint(node.ID); pt != nil {
			node.CPUUsage = pt.CPUUsage
			node.MemoryUsage = pt.MemoryUsage
			node.ActiveConnections = fmt.Sprintf("%d", pt.ActiveConnections)
			node.RequestsPerSecond = fmt.Sprintf("%.1f", pt.RPS)
		} else {
			node.ActiveConnections = "0"
			node.RequestsPerSecond = "0"
		}
	} else {
		node.ActiveConnections = "0"
		node.RequestsPerSecond = "0"
	}
	return node, nil
}

// RecordHeartbeat tiếp nhận và xử lý gói tin Push Heartbeat Telemetry gửi từ Node.
func (s *nodeService) RecordHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) error {
	if payload.NodeID == "" {
		return errors.New("node_id không được để trống")
	}
	if payload.Timestamp <= 0 {
		payload.Timestamp = time.Now().Unix()
	}

	// 1. Cập nhật thời điểm heartbeat và liveness vào SQLite
	if err := s.repo.UpdateHeartbeat(ctx, payload); err != nil {
		return fmt.Errorf("nodeService.RecordHeartbeat: %w", err)
	}

	// 2. Đẩy điểm đo tức thời vào In-Memory Ring Buffer trong MetricsService
	if s.metricsSvc != nil {
		now := time.Now().Unix()
		minutesAgo := int(float64(now-payload.Timestamp) / 60.0)
		label := fmt.Sprintf("-%dm", minutesAgo)
		if minutesAgo <= 0 {
			label = "Now"
		}

		s.metricsSvc.PushMetricPoint(payload.NodeID, entity.NodeMetricPoint{
			Timestamp:         payload.Timestamp,
			TimeLabel:         label,
			RPS:               payload.RequestsPerSecond,
			CPUUsage:          payload.CPUUsage,
			MemoryUsage:       payload.MemoryUsage,
			ActiveConnections: payload.ActiveConnections,
		})
	}

	return nil
}
