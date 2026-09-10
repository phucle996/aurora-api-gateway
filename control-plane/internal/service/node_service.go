package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
)

type nodeLiveState struct {
	ID               string
	Hostname         string
	IP               string
	Status           string // "Ready", "Degraded", "Offline"
	Version          string
	ActiveReleaseID  int64
	DesiredReleaseID int64
	LastSeen         time.Time
	RuntimeStartedAt int64
	WorkerIdentity   string
	Role             string
	MetadataDigest   string
	Metadata         *entity.NginxMetadata
	PendingCommand   string
	ReloadStatus     string
	LastTimestamp    int64
	MetricsScope      string
	Certificate       string
	MetricsAvailable  bool
	CPUUsage          float64
	MemoryUsage       float64
	ActiveConnections string
	RequestsPerSecond string
}

type nodeService struct {
	heartbeatMu sync.Mutex
	repo        repo.NodeRepository
	metricsSvc  domainService.MetricsService
	eventHub    provider.EventHub

	nodesMu sync.RWMutex
	nodes   map[string]*nodeLiveState

	batchMu      sync.Mutex
	pendingBeats map[string]entity.NodeHeartbeatEvent
}

// NewNodeService khởi tạo service quản lý workflow Nodes.
func NewNodeService(repo repo.NodeRepository, metricsSvc domainService.MetricsService, eventHub provider.EventHub) domainService.NodeService {
	s := &nodeService{
		repo:         repo,
		metricsSvc:   metricsSvc,
		eventHub:     eventHub,
		nodes:        make(map[string]*nodeLiveState),
		pendingBeats: make(map[string]entity.NodeHeartbeatEvent),
	}

	if eventHub != nil {
		go s.flushLoop(1200 * time.Millisecond)
	}

	go s.livenessReaper(5 * time.Second)

	return s
}

func (s *nodeService) livenessReaper(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		var offlineEvents []entity.NodeHeartbeatEvent

		s.nodesMu.Lock()
		for id, node := range s.nodes {
			if node.Status != "Offline" && now.Sub(node.LastSeen) > 15*time.Second {
				node.Status = "Offline"
				offlineEvents = append(offlineEvents, entity.NodeHeartbeatEvent{
					NodeID:           node.ID,
					IP:               node.IP,
					Status:           "Not Ready",
					Timestamp:        now.Unix(),
					RuntimeStartedAt: node.RuntimeStartedAt,
				})
			}
			// Xóa các node không hoạt động quá 10 phút khỏi RAM
			if now.Sub(node.LastSeen) > 10*time.Minute {
				delete(s.nodes, id)
			}
		}
		s.nodesMu.Unlock()

		if len(offlineEvents) > 0 && s.eventHub != nil {
			s.eventHub.Broadcast("nodes_heartbeat", offlineEvents)
		}
	}
}

// SubscribeEvents đăng ký nhận luồng sự kiện realtime từ hệ thống.
func (s *nodeService) SubscribeEvents() (<-chan entity.SSEMessage, func()) {
	if s.eventHub == nil {
		return nil, func() {}
	}
	return s.eventHub.Subscribe()
}

// queueHeartbeat đưa sự kiện nhịp tim của một node vào hàng chờ để gom batch gửi chung một lượt qua SSE.
func (s *nodeService) queueHeartbeat(evt entity.NodeHeartbeatEvent) {
	s.batchMu.Lock()
	defer s.batchMu.Unlock()
	s.pendingBeats[evt.NodeID] = evt
}

// flushLoop định kỳ gom tất cả pending node heartbeats và bắn 1 event duy nhất lên client qua EventHub.
func (s *nodeService) flushLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		s.flushBatch()
	}
}

func (s *nodeService) flushBatch() {
	s.batchMu.Lock()
	if len(s.pendingBeats) == 0 {
		s.batchMu.Unlock()
		return
	}

	batch := make([]entity.NodeHeartbeatEvent, 0, len(s.pendingBeats))
	for _, beat := range s.pendingBeats {
		batch = append(batch, beat)
	}
	s.pendingBeats = make(map[string]entity.NodeHeartbeatEvent)
	s.batchMu.Unlock()

	if s.eventHub != nil {
		s.eventHub.Broadcast("nodes_heartbeat", batch)
	}
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

	s.nodesMu.RLock()
	defer s.nodesMu.RUnlock()

	now := time.Now().UTC()
	nodeMap := make(map[string]*entity.ClusterNodeRecord, len(nodes))
	for i := range nodes {
		nodeMap[nodes[i].ID] = &nodes[i]
	}

	// Merge các node từ in-memory live states
	for id, live := range s.nodes {
		rec, exists := nodeMap[id]
		if !exists {
			var relID *int64
			if live.ActiveReleaseID > 0 {
				r := live.ActiveReleaseID
				relID = &r
			}
			newNode := entity.ClusterNodeRecord{
				ID:               live.ID,
				Name:             live.ID,
				Hostname:         live.Hostname,
				IP:               live.IP,
				Version:          live.Version,
				Status:           live.Status,
				ActiveReleaseID:  relID,
				RuntimeStartedAt: live.RuntimeStartedAt,
				MetricsScope:     live.MetricsScope,
				Certificate:      live.Certificate,
			}
			nodes = append(nodes, newNode)
			rec = &nodes[len(nodes)-1]
			nodeMap[id] = rec
		} else {
			if live.Hostname != "" {
				rec.Hostname = live.Hostname
			}
			if live.MetricsScope != "" {
				rec.MetricsScope = live.MetricsScope
			}
			if live.Certificate != "" {
				rec.Certificate = live.Certificate
			}
			if live.RuntimeStartedAt > 0 {
				rec.RuntimeStartedAt = live.RuntimeStartedAt
			}
		}

		diff := now.Sub(live.LastSeen)
		rec.LastHeartbeatTimestamp = live.LastSeen.Unix()
		if diff < time.Minute {
			rec.LastHeartbeat = fmt.Sprintf("%ds ago", int(diff.Seconds()))
		} else if diff < time.Hour {
			rec.LastHeartbeat = fmt.Sprintf("%dm ago", int(diff.Minutes()))
		} else {
			rec.LastHeartbeat = fmt.Sprintf("%dh ago", int(diff.Hours()))
		}

		if diff > 15*time.Second {
			rec.Status = "Not Ready"
			rec.Uptime = "Offline"
		} else {
			rec.Status = live.Status
			if rec.Status == "" || rec.Status == "HEALTH_STATUS_SERVING" {
				rec.Status = "Ready"
			}
			if live.RuntimeStartedAt > 0 {
				rec.Uptime = formatNodeUptime(time.Unix(live.RuntimeStartedAt, 0).UTC().Format(time.RFC3339), now)
			} else {
				rec.Uptime = "Unknown"
			}
		}

		if live.ActiveReleaseID > 0 {
			r := live.ActiveReleaseID
			rec.ActiveReleaseID = &r
			if live.DesiredReleaseID > 0 && live.ActiveReleaseID != live.DesiredReleaseID {
				rec.SyncStatus = "Drift"
				rec.PolicySync = "Drift Detected"
			} else {
				rec.SyncStatus = "In Sync"
				rec.PolicySync = "Synchronized"
			}
		}
	}

	for i := range nodes {
		node := &nodes[i]
		if _, inLive := s.nodes[node.ID]; !inLive {
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
				if diff <= 15*time.Second {
					node.Status = "Ready"
				}
			}
		}

		if node.Status != "Ready" {
			node.PolicySync = "Unknown (stale heartbeat)"
		}

		s.nodesMu.RLock()
		live, hasLive := s.nodes[node.ID]
		if hasLive && live.MetricsAvailable && node.Status == "Ready" {
			node.MetricsAvailable = true
			node.CPUUsage = live.CPUUsage
			node.MemoryUsage = live.MemoryUsage
			node.ActiveConnections = live.ActiveConnections
			node.RequestsPerSecond = live.RequestsPerSecond
		} else {
			node.ActiveConnections = "—"
			node.RequestsPerSecond = "—"
		}
		s.nodesMu.RUnlock()
	}

	return nodes, nil
}

// GetNodeByID lấy thông tin chi tiết của một node cụ thể theo ID.
func (s *nodeService) GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error) {
	node, err := s.repo.GetNodeByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("nodeService.GetNodeByID: %w", err)
	}

	s.nodesMu.RLock()
	live, inLive := s.nodes[id]
	s.nodesMu.RUnlock()

	now := time.Now().UTC()
	if node == nil && inLive {
		var relID *int64
		if live.ActiveReleaseID > 0 {
			r := live.ActiveReleaseID
			relID = &r
		}
		newNode := &entity.ClusterNodeRecord{
			ID:               live.ID,
			Name:             live.ID,
			Hostname:         live.Hostname,
			IP:               live.IP,
			Version:          live.Version,
			Status:           live.Status,
			ActiveReleaseID:  relID,
			RuntimeStartedAt: live.RuntimeStartedAt,
			MetricsScope:     live.MetricsScope,
			Certificate:      live.Certificate,
		}
		node = newNode
	}

	if node == nil {
		return nil, nil
	}

	if inLive {
		if live.Hostname != "" {
			node.Hostname = live.Hostname
		}
		if live.MetricsScope != "" {
			node.MetricsScope = live.MetricsScope
		}
		if live.Certificate != "" {
			node.Certificate = live.Certificate
		}
		if live.RuntimeStartedAt > 0 {
			node.RuntimeStartedAt = live.RuntimeStartedAt
		}
		diff := now.Sub(live.LastSeen)
		node.LastHeartbeatTimestamp = live.LastSeen.Unix()
		if diff < time.Minute {
			node.LastHeartbeat = fmt.Sprintf("%ds ago", int(diff.Seconds()))
		} else if diff < time.Hour {
			node.LastHeartbeat = fmt.Sprintf("%dm ago", int(diff.Minutes()))
		} else {
			node.LastHeartbeat = fmt.Sprintf("%dh ago", int(diff.Hours()))
		}

		if diff > 15*time.Second {
			node.Status = "Not Ready"
			node.Uptime = "Offline"
		} else {
			node.Status = live.Status
			if node.Status == "" || node.Status == "HEALTH_STATUS_SERVING" {
				node.Status = "Ready"
			}
			if live.RuntimeStartedAt > 0 {
				node.Uptime = formatNodeUptime(time.Unix(live.RuntimeStartedAt, 0).UTC().Format(time.RFC3339), now)
			} else {
				node.Uptime = "Unknown"
			}
		}

		if live.ActiveReleaseID > 0 {
			r := live.ActiveReleaseID
			node.ActiveReleaseID = &r
			if live.DesiredReleaseID > 0 && live.ActiveReleaseID != live.DesiredReleaseID {
				node.SyncStatus = "Drift"
				node.PolicySync = "Drift Detected"
			} else {
				node.SyncStatus = "In Sync"
				node.PolicySync = "Synchronized"
			}
		}
	} else {
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

			if diff > 15*time.Second {
				node.Status = "Not Ready"
				node.Uptime = "Offline"
			} else {
				node.Status = "Ready"
				if node.RuntimeStartedAt > 0 {
					node.Uptime = formatNodeUptime(time.Unix(node.RuntimeStartedAt, 0).UTC().Format(time.RFC3339), now)
				}
			}
		}
	}

	if node.Status != "Ready" {
		node.PolicySync = "Unknown (stale heartbeat)"
	}

	s.nodesMu.RLock()
	live, hasLive := s.nodes[node.ID]
	if hasLive && live.MetricsAvailable && node.Status == "Ready" {
		node.MetricsAvailable = true
		node.CPUUsage = live.CPUUsage
		node.MemoryUsage = live.MemoryUsage
		node.ActiveConnections = live.ActiveConnections
		node.RequestsPerSecond = live.RequestsPerSecond
	} else {
		node.ActiveConnections = "—"
		node.RequestsPerSecond = "—"
	}
	s.nodesMu.RUnlock()

	return node, nil
}

// GetNodeConfig truy vấn trực tiếp file cấu hình NGINX thật (/etc/nginx/nginx.conf) từ node container.
func (s *nodeService) GetNodeConfig(ctx context.Context, nodeID string) (string, error) {
	node, err := s.repo.GetNodeByID(ctx, nodeID)
	if err != nil {
		return "", fmt.Errorf("nodeService.GetNodeConfig: %w", err)
	}
	if node == nil {
		return "", errors.New("node does not exist")
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
		Timeout:       3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
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
			body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
			resp.Body.Close()
			if err != nil || len(body) > 1024*1024 {
				if err == nil {
					err = errors.New("node config exceeds 1 MiB")
				}
				lastErr = err
				continue
			}
			// Redact at the API boundary as well, including older nodes.
			redactor := regexp.MustCompile(`(?s)\baurora_waf_token\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^;]*);`)
			return redactor.ReplaceAllString(string(body), "aurora_waf_token [REDACTED];"), nil
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
// Xử lý 100% In-Memory (No-Write to SQLite) để đảm bảo throughput cao và triệt tiêu lock contention.
func (s *nodeService) RecordHeartbeat(ctx context.Context, payload entity.NodeHeartbeatPayload) (*entity.NodeCommandDirective, error) {
	now := time.Now()
	metadataAcknowledged := false

	s.nodesMu.Lock()
	node, exists := s.nodes[payload.NodeID]
	var prevReleaseID int64
	var prevReloadStatus string
	var prevWorkerIdentity string

	if !exists {
		hostname := payload.Hostname
		if payload.Metadata != nil && payload.Metadata.Hostname != "" {
			hostname = payload.Metadata.Hostname
		}
		node = &nodeLiveState{
			ID:               payload.NodeID,
			Hostname:         hostname,
			IP:               payload.IP,
			Status:           "Ready",
			PendingCommand:   "none",
			ReloadStatus:     "none",
			RuntimeStartedAt: payload.RuntimeStartedAt,
			MetricsScope:     payload.MetricsScope,
			Certificate:      payload.Authentication,
		}
		s.nodes[payload.NodeID] = node

		// Đảm bảo node tồn tại trong bảng SQLite 1 lần duy nhất khi node xuất hiện lần đầu
		_ = s.repo.EnsureNodeExists(ctx, payload.NodeID, payload.IP, hostname)
	} else {
		prevReleaseID = node.ActiveReleaseID
		prevReloadStatus = node.ReloadStatus
		prevWorkerIdentity = node.WorkerIdentity
	}

	if node.LastTimestamp > 0 && payload.Timestamp <= node.LastTimestamp {
		s.nodesMu.Unlock()
		return &entity.NodeCommandDirective{Action: "none"}, nil
	}
	node.LastTimestamp = payload.Timestamp
	node.LastSeen = now
	if payload.Status != "" {
		node.Status = payload.Status
	} else {
		node.Status = "Ready"
	}
	if payload.IP != "" {
		node.IP = payload.IP
	}
	if payload.ActiveReleaseID > 0 {
		node.ActiveReleaseID = payload.ActiveReleaseID
	}
	if payload.WorkerIdentity != "" {
		node.WorkerIdentity = payload.WorkerIdentity
	}
	if payload.Hostname != "" {
		node.Hostname = payload.Hostname
	}
	if payload.RuntimeStartedAt > 0 {
		node.RuntimeStartedAt = payload.RuntimeStartedAt
	}
	if payload.MetricsScope != "" {
		node.MetricsScope = payload.MetricsScope
	}
	if payload.Authentication != "" {
		node.Certificate = payload.Authentication
	}
	if payload.MetadataDigest != "" {
		node.MetadataDigest = payload.MetadataDigest
	}
	if payload.Metadata != nil {
		node.Metadata = payload.Metadata
		if payload.Metadata.Version != "" {
			node.Version = payload.Metadata.Version
		}
		if payload.Metadata.Hostname != "" {
			node.Hostname = payload.Metadata.Hostname
		}
		if payload.Metadata.RuntimeStartedAt > 0 {
			node.RuntimeStartedAt = payload.Metadata.RuntimeStartedAt
		}
		if payload.Metadata.WorkerIdentity != "" {
			node.WorkerIdentity = payload.Metadata.WorkerIdentity
		}
		if payload.Metadata.Role != "" {
			node.Role = payload.Metadata.Role
		}
		metadataAcknowledged = true
	}

	// 1. Kiểm tra lệnh đang chờ
	action := "none"
	if node.PendingCommand != "" && node.PendingCommand != "none" {
		action = node.PendingCommand
		node.PendingCommand = "none"
		node.ReloadStatus = "reloading"
	}

	// 2. Lấy bản release mới nhất mong muốn và lệnh pending từ DB nếu có
	cmd, desiredRelease, _ := s.repo.GetNodeCommandAndLatestRelease(ctx, payload.NodeID)
	if cmd != "" && cmd != "none" && action == "none" {
		action = cmd
		node.ReloadStatus = "reloading"
	}
	if desiredRelease > 0 && node.ActiveReleaseID > 0 && node.ActiveReleaseID < desiredRelease && action == "none" {
		action = "reload"
	}
	node.DesiredReleaseID = desiredRelease

	if payload.MetricsAvailable {
		node.MetricsAvailable = true
		node.CPUUsage = payload.CPUUsage
		node.MemoryUsage = payload.MemoryUsage
		node.ActiveConnections = fmt.Sprintf("%d", payload.ActiveConnections)
		node.RequestsPerSecond = fmt.Sprintf("%.1f", payload.RequestsPerSecond)
	}

	nodeStatus := node.Status
	runtimeStartedAt := node.RuntimeStartedAt
	nodeIP := node.IP
	activeRelID := node.ActiveReleaseID
	workerIdentity := node.WorkerIdentity
	s.nodesMu.Unlock()

	// 4. Tính toán Sync Status cho realtime event
	syncStatus := "In Sync"
	if desiredRelease > 0 && activeRelID > 0 && activeRelID != desiredRelease {
		syncStatus = "Drift"
	}
	rulesetName := "none"
	if activeRelID > 0 {
		rulesetName = fmt.Sprintf("rev-%d", activeRelID)
	}

	// 5. Đưa nhịp tim vào hàng đợi gom batch để phát sóng chung 1 event duy nhất
	if s.eventHub != nil {
		s.queueHeartbeat(entity.NodeHeartbeatEvent{
			NodeID:           payload.NodeID,
			MetricsScope:     payload.MetricsScope,
			MetricsAvailable: payload.MetricsAvailable,
			RuntimeStartedAt: runtimeStartedAt,
			IP:               nodeIP,
			Status:           nodeStatus,
			RPS:              payload.RequestsPerSecond,
			ActiveConns:      payload.ActiveConnections,
			CPUUsage:         payload.CPUUsage,
			MemoryUsage:      payload.MemoryUsage,
			Sync:             syncStatus,
			Ruleset:          rulesetName,
			Timestamp:        payload.Timestamp,
		})
	}

	// 6. Phát hiện và ghi nhận sự kiện đồng bộ thực tế vào node_sync_logs
	if !exists {
		if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "release_applied", nil, fmt.Sprintf("Node %s tham gia cụm và kích hoạt heartbeat", payload.NodeID)); err == nil && s.eventHub != nil {
			s.eventHub.Broadcast("node_sync", logRec)
		}
	} else {
		if activeRelID > 0 && activeRelID != prevReleaseID {
			msg := fmt.Sprintf("Node áp dụng thành công ruleset release #%d", activeRelID)
			relID := activeRelID
			if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "release_applied", &relID, msg); err == nil && s.eventHub != nil {
				s.eventHub.Broadcast("node_sync", logRec)
			}
		}
		if prevReloadStatus == "reloading" && prevWorkerIdentity != "" && workerIdentity != "" && prevWorkerIdentity != workerIdentity {
			msg := "Hoàn tất reload worker NGINX áp dụng cấu hình mới"
			s.nodesMu.Lock()
			node.ReloadStatus = "completed"
			s.nodesMu.Unlock()
			_ = s.repo.SetNodeCommand(ctx, payload.NodeID, "none", "completed")
			if logRec, err := s.repo.InsertSyncLog(ctx, payload.NodeID, "reload_completed", nil, msg); err == nil && s.eventHub != nil {
				s.eventHub.Broadcast("node_sync", logRec)
			}
			pending, reloading, _, _ := s.repo.GetRollingNodesStatus(ctx)
			if len(reloading) == 0 && len(pending) > 0 {
				nextNodeID := pending[0]
				_ = s.repo.SetNodeCommand(ctx, nextNodeID, "reload_process", "pending")
				s.nodesMu.Lock()
				if nextNode, ok := s.nodes[nextNodeID]; ok {
					nextNode.PendingCommand = "reload_process"
					nextNode.ReloadStatus = "pending"
				}
				s.nodesMu.Unlock()
			}
		}
	}

	return &entity.NodeCommandDirective{
		Action:               action,
		DesiredReleaseID:     desiredRelease,
		MetadataAcknowledged: metadataAcknowledged,
	}, nil
}

// TriggerNodeReload yêu cầu thực hiện reload cho một node cụ thể.
func (s *nodeService) TriggerNodeReload(ctx context.Context, nodeID string) error {
	s.nodesMu.Lock()
	if n, ok := s.nodes[nodeID]; ok {
		n.PendingCommand = "reload_process"
		n.ReloadStatus = "pending"
	}
	s.nodesMu.Unlock()
	return s.repo.SetNodeCommand(ctx, nodeID, "reload_process", "pending")
}

// TriggerRollingReload kích hoạt chu trình rolling reload tuần tự trên các nodes.
func (s *nodeService) TriggerRollingReload(ctx context.Context) (*entity.RollingStatus, error) {
	nodes, err := s.repo.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("truy vấn danh sách node thất bại: %w", err)
	}
	if len(nodes) == 0 {
		return nil, errors.New("không có node nào để thực hiện rolling reload")
	}

	nodeIDs := make([]string, 0, len(nodes))
	for _, n := range nodes {
		nodeIDs = append(nodeIDs, n.ID)
	}

	if err := s.repo.SetRollingReload(ctx, nodeIDs); err != nil {
		return nil, err
	}

	pending := []string{}
	if len(nodeIDs) > 1 {
		pending = nodeIDs[1:]
	}

	return &entity.RollingStatus{
		Active:         true,
		CurrentNodeID:  nodeIDs[0],
		PendingNodes:   pending,
		CompletedNodes: []string{},
		Message:        fmt.Sprintf("Đã bắt đầu Rolling Reload tuần tự cho %d node (Node bắt đầu: %s)", len(nodeIDs), nodeIDs[0]),
	}, nil
}

// GetRollingStatus trả về trạng thái tiến trình rolling reload hiện tại.
func (s *nodeService) GetRollingStatus(ctx context.Context) (*entity.RollingStatus, error) {
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

	return &entity.RollingStatus{
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
