package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type nodeService struct {
	repo       repo.NodeRepository
	metricsSvc domainService.MetricsService
	eventHub   EventHub
}

// NewNodeService khởi tạo service quản lý workflow Cluster Nodes.
func NewNodeService(repo repo.NodeRepository, metricsSvc domainService.MetricsService) domainService.NodeService {
	return &nodeService{
		repo:       repo,
		metricsSvc: metricsSvc,
		eventHub:   NewEventHub(),
	}
}

// SubscribeEvents đăng ký nhận luồng sự kiện realtime từ hệ thống.
func (s *nodeService) SubscribeEvents() (<-chan entity.SSEMessage, func()) {
	return s.eventHub.Subscribe()
}

// ListNodeSyncLogs truy vấn danh sách log đồng bộ của một node.
func (s *nodeService) ListNodeSyncLogs(ctx context.Context, nodeID string, limit int) ([]entity.NodeSyncLogRecord, error) {
	return s.repo.ListNodeSyncLogs(ctx, nodeID, limit)
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
		t, err := time.Parse(time.RFC3339Nano, node.LastHeartbeat)
		if err != nil {
			t, err = time.ParseInLocation("2006-01-02 15:04:05", node.LastHeartbeat, time.UTC)
		}
		node.Status = "Not Ready"
		node.Uptime = "Offline"
		if err == nil {
			node.LastHeartbeatTimestamp = t.Unix()
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
				node.Uptime = formatNodeUptime(node.CreatedAt, now)
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
	t, parseErr := time.Parse(time.RFC3339Nano, node.LastHeartbeat)
	if parseErr != nil {
		t, parseErr = time.ParseInLocation("2006-01-02 15:04:05", node.LastHeartbeat, time.UTC)
	}
	node.Status = "Not Ready"
	node.Uptime = "Offline"
	if parseErr == nil {
		node.LastHeartbeatTimestamp = t.Unix()
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
			node.Uptime = formatNodeUptime(node.CreatedAt, now)
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

// GetNodeConfig truy vấn trực tiếp file cấu hình NGINX thật (/etc/nginx/nginx.conf) từ node container.
func (s *nodeService) GetNodeConfig(ctx context.Context, nodeID string) (string, error) {
	node, err := s.repo.GetNodeByID(ctx, nodeID)
	if err != nil {
		return "", fmt.Errorf("nodeService.GetNodeConfig: %w", err)
	}
	if node == nil {
		return "", errors.New("node không tồn tại trong cluster")
	}

	// Thử các endpoint khả dụng của node theo thứ tự:
	// 1. IP của node
	// 2. Domain / Hostname của node
	// Không gán cứng port (tự động theo scheme/host hoặc port tuỳ biến đi kèm)
	formatEndpoint := func(host string) string {
		h := strings.TrimSpace(host)
		if h == "" {
			return ""
		}
		if strings.HasPrefix(h, "http://") || strings.HasPrefix(h, "https://") {
			return fmt.Sprintf("%s/_aurora/config", strings.TrimRight(h, "/"))
		}
		return fmt.Sprintf("http://%s/_aurora/config", strings.TrimRight(h, "/"))
	}

	targets := make([]string, 0, 2)
	if ep := formatEndpoint(node.IP); ep != "" {
		targets = append(targets, ep)
	}
	if ep := formatEndpoint(node.Hostname); ep != "" && (len(targets) == 0 || ep != targets[0]) {
		targets = append(targets, ep)
	}

	client := &http.Client{
		Timeout: 3 * time.Second,
	}

	var lastErr error
	for _, targetURL := range targets {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		if err != nil {
			lastErr = err
			continue
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode == http.StatusOK {
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				lastErr = err
				continue
			}
			return string(body), nil
		}
		resp.Body.Close()
		lastErr = fmt.Errorf("node trả về mã HTTP %d từ %s", resp.StatusCode, targetURL)
	}

	if lastErr == nil {
		lastErr = errors.New("không thể phân giải địa chỉ mạng của node")
	}
	return "", fmt.Errorf("không thể kéo file cấu hình từ node %s: %w", nodeID, lastErr)
}

// RecordHeartbeat tiếp nhận và xử lý gói tin Push Heartbeat Telemetry gửi từ Node, đồng thời trả về chỉ thị lệnh từ Control Plane.
func (s *nodeService) RecordHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) (*entity.NodeCommandDirective, error) {
	if payload.NodeID == "" {
		return nil, errors.New("node_id không được để trống")
	}
	if payload.Timestamp <= 0 {
		payload.Timestamp = time.Now().Unix()
	}

	// 0. Lấy trạng thái trước đó của node để phát hiện State Transitions (release change, reload)
	prevNode, _ := s.repo.GetNodeByID(ctx, payload.NodeID)

	// 1. Cập nhật thời điểm heartbeat và liveness vào SQLite
	if err := s.repo.UpdateHeartbeat(ctx, payload); err != nil {
		return nil, fmt.Errorf("nodeService.RecordHeartbeat: %w", err)
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

	// 3. Lấy chỉ thị lệnh chờ thực thi và bản release mong muốn
	action, desiredRelease, err := s.repo.GetNodeCommandAndLatestRelease(ctx, payload.NodeID)
	if err != nil {
		action = "none"
	}
	if action == "" {
		action = "none"
	}

	// 4. Tính toán Sync Status và Ruleset Name cho realtime event
	syncStatus := "In Sync"
	if desiredRelease > 0 {
		if payload.ActiveReleaseID != desiredRelease {
			syncStatus = "Drift"
		}
	}
	rulesetName := "none"
	if payload.ActiveReleaseID > 0 {
		rulesetName = fmt.Sprintf("rev-%d", payload.ActiveReleaseID)
	}

	// 5. Đưa nhịp tim vào hàng đợi gom batch để phát sóng chung 1 event duy nhất
	if s.eventHub != nil {
		s.eventHub.QueueHeartbeat(entity.NodeHeartbeatEvent{
			NodeID:      payload.NodeID,
			IP:          payload.IP,
			Status:      "Ready",
			RPS:         payload.RequestsPerSecond,
			ActiveConns: payload.ActiveConnections,
			CPUUsage:    payload.CPUUsage,
			MemoryUsage: payload.MemoryUsage,
			Sync:        syncStatus,
			Ruleset:     rulesetName,
			Timestamp:   payload.Timestamp,
		})
	}

	// 6. Phát hiện và ghi nhận sự kiện đồng bộ thực tế vào node_sync_logs
	if prevNode == nil {
		// Node mới tham gia cluster lần đầu
		if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "release_applied", nil, fmt.Sprintf("Node %s tham gia cụm và kích hoạt heartbeat", payload.NodeID)); err == nil && s.eventHub != nil {
			s.eventHub.Broadcast("node_sync", logRec)
		}
	} else {
		// Đổi release
		if payload.ActiveReleaseID > 0 && (prevNode.ActiveReleaseID == nil || *prevNode.ActiveReleaseID != payload.ActiveReleaseID) {
			msg := fmt.Sprintf("Node áp dụng thành công ruleset release #%d", payload.ActiveReleaseID)
			relID := payload.ActiveReleaseID
			if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "release_applied", &relID, msg); err == nil && s.eventHub != nil {
				s.eventHub.Broadcast("node_sync", logRec)
			}
		}
		// Vừa hoàn thành reload
		if prevNode.ReloadStatus == "reloading" {
			msg := "Hoàn tất reload worker NGINX áp dụng cấu hình mới"
			if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "reload_completed", nil, msg); err == nil && s.eventHub != nil {
				s.eventHub.Broadcast("node_sync", logRec)
			}
		}
	}

	// 7. Nếu node này vừa hoàn thành reload, kích hoạt node kế tiếp trong hàng đợi rolling cluster
	node, err := s.repo.GetNodeByID(ctx, payload.NodeID)
	if err == nil && node != nil && node.ReloadStatus == "completed" {
		pending, reloading, _, _ := s.repo.GetRollingNodesStatus(ctx)
		if len(reloading) == 0 && len(pending) > 0 {
			nextNodeID := pending[0]
			_ = s.repo.SetNodeCommand(ctx, nextNodeID, "reload_process", "pending")
		}
	}

	return &entity.NodeCommandDirective{
		Action:           action,
		DesiredReleaseID: desiredRelease,
	}, nil
}

// TriggerNodeReload yêu cầu thực hiện reload cho một node cụ thể.
func (s *nodeService) TriggerNodeReload(ctx context.Context, nodeID string) error {
	node, err := s.repo.GetNodeByID(ctx, nodeID)
	if err != nil {
		return fmt.Errorf("truy vấn node thất bại: %w", err)
	}
	if node == nil {
		return fmt.Errorf("không tìm thấy node %s", nodeID)
	}
	return s.repo.SetNodeCommand(ctx, nodeID, "reload_process", "pending")
}

// TriggerClusterRollingReload kích hoạt chu trình rolling reload tuần tự trên toàn bộ cụm.
func (s *nodeService) TriggerClusterRollingReload(ctx context.Context) (*entity.ClusterRollingStatus, error) {
	nodes, err := s.repo.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("truy vấn danh sách node thất bại: %w", err)
	}
	if len(nodes) == 0 {
		return nil, errors.New("không có node nào trong cluster để thực hiện rolling reload")
	}

	nodeIDs := make([]string, 0, len(nodes))
	for _, n := range nodes {
		nodeIDs = append(nodeIDs, n.ID)
	}

	if err := s.repo.SetClusterRollingReload(ctx, nodeIDs); err != nil {
		return nil, err
	}

	pending := []string{}
	if len(nodeIDs) > 1 {
		pending = nodeIDs[1:]
	}

	return &entity.ClusterRollingStatus{
		Active:         true,
		CurrentNodeID:  nodeIDs[0],
		PendingNodes:   pending,
		CompletedNodes: []string{},
		Message:        fmt.Sprintf("Đã bắt đầu Rolling Reload tuần tự cho %d node trong cụm (Node bắt đầu: %s)", len(nodeIDs), nodeIDs[0]),
	}, nil
}

// GetClusterRollingStatus trả về trạng thái tiến trình rolling reload hiện tại của cụm.
func (s *nodeService) GetClusterRollingStatus(ctx context.Context) (*entity.ClusterRollingStatus, error) {
	pending, reloading, completed, err := s.repo.GetRollingNodesStatus(ctx)
	if err != nil {
		return nil, err
	}

	active := len(pending) > 0 || len(reloading) > 0
	current := ""
	if len(reloading) > 0 {
		current = reloading[0]
	} else if len(pending) > 0 {
		current = pending[0]
	}

	msg := "Hệ thống đang hoạt động ổn định, không có tiến trình rolling reload nào."
	if active {
		msg = fmt.Sprintf("Tiến trình Rolling Reload đang diễn ra: Node đang xử lý: %s, Còn lại: %d, Hoàn tất: %d", current, len(pending), len(completed))
	}

	return &entity.ClusterRollingStatus{
		Active:         active,
		CurrentNodeID:  current,
		PendingNodes:   pending,
		CompletedNodes: completed,
		Message:        msg,
	}, nil
}

// formatNodeUptime chuyển đổi mốc thời gian đăng ký (CreatedAt) thành chuỗi thời gian uptime thực tế.
func formatNodeUptime(createdAtStr string, now time.Time) string {
	if createdAtStr == "" {
		return "0s"
	}
	tc, err := time.Parse(time.RFC3339Nano, createdAtStr)
	if err != nil {
		tc, err = time.ParseInLocation("2006-01-02 15:04:05", createdAtStr, time.UTC)
	}
	if err != nil {
		return "0s"
	}

	diff := now.Sub(tc)
	if diff < 0 {
		diff = 0
	}

	days := int(diff.Hours()) / 24
	hours := int(diff.Hours()) % 24
	minutes := int(diff.Minutes()) % 60
	seconds := int(diff.Seconds()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd %dh %dm", days, hours, minutes)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, minutes, seconds)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm %ds", minutes, seconds)
	}
	return fmt.Sprintf("%ds", seconds)
}

