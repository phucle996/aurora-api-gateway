package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// Thời gian chờ tối đa cho các tác vụ quản lý NGINX Node
const (
	nodeQueryTimeout     = 5 * time.Second  // Dành cho List, GetByID, GetRollingStatus, GetSyncLogs, GetConfig
	nodeHeartbeatTimeout = 5 * time.Second  // Dành cho Heartbeat xử lý telemetry và trả về chỉ thị
	nodeReloadTimeout    = 15 * time.Second // Dành cho ReloadNode và RollingReloadCluster điều phối cụm
)

// NodeHandler bao đóng các HTTP endpoint xử lý cho NGINX Data Plane Nodes.
type NodeHandler struct {
	service port.NodeService
}

// NewNodeHandler khởi tạo NodeHandler với service tương ứng.
func NewNodeHandler(s port.NodeService) *NodeHandler {
	return &NodeHandler{service: s}
}

// List xử lý HTTP GET /api/v1/nodes:
// Trả về danh sách tất cả các NGINX Data Plane nodes đã đăng ký trong cluster.
func (h *NodeHandler) List(c *gin.Context) {
	// Bước 1: Tiếp nhận context từ HTTP request kèm timeout 5s
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	// Bước 2: Gọi service để lấy danh sách nodes cùng trạng thái runtime
	nodes, err := h.service.ListNodes(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "node list query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list nodes: " + err.Error()})
		return
	}

	// Bước 3: Map tường minh từng entity sang gin.H để cố định schema JSON
	response := make([]gin.H, 0, len(nodes))
	for i := range nodes {
		node := &nodes[i]
		response = append(response, gin.H{
			"id":                     node.ID,
			"name":                   node.Name,
			"hostname":               node.Hostname,
			"ip":                     node.IP,
			"status":                 node.Status,
			"version":                node.Version,
			"active_release_id":      node.ActiveReleaseID,
			"ruleset":                node.Ruleset,
			"sync":                   node.SyncStatus,
			"lastHeartbeat":          node.LastHeartbeat,
			"lastHeartbeatTimestamp": node.LastHeartbeatTimestamp,
			"created_at":             node.CreatedAt,
			"joinMethod":             node.JoinMethod,
			"certificate":            node.Certificate,
			"policySync":             node.PolicySync,
			"lastSyncTime":           node.LastSyncTime,
			"cpuUsage":               node.CPUUsage,
			"memoryUsage":            node.MemoryUsage,
			"activeConnections":      node.ActiveConnections,
			"requestsPerSecond":      node.RequestsPerSecond,
			"uptime":                 node.Uptime,
			"runtimeStartedAt":       node.RuntimeStartedAt,
			"metricsScope":           node.MetricsScope,
			"metricsAvailable":       node.MetricsAvailable,
		})
	}

	// Bước 4: Trả về kết quả HTTP 200 OK định dạng JSON
	c.JSON(http.StatusOK, response)
}

// GetByID xử lý HTTP GET /api/v1/nodes/:id:
// Trả về chi tiết của một node cụ thể trong cluster.
func (h *NodeHandler) GetByID(c *gin.Context) {
	// Bước 1: Lấy và thẩm định tham số ID từ URL path
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	// Bước 2: Gọi service lấy thông tin chi tiết kèm timeout 5s
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	node, err := h.service.GetNodeByID(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get node timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get node: " + err.Error()})
		return
	}

	// Bước 3: Kiểm tra sự tồn tại của node
	if node == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "node not found"})
		return
	}

	// Bước 4: Map tường minh sang gin.H và trả về HTTP 200 OK
	c.JSON(http.StatusOK, gin.H{
		"id":                     node.ID,
		"name":                   node.Name,
		"hostname":               node.Hostname,
		"ip":                     node.IP,
		"status":                 node.Status,
		"version":                node.Version,
		"active_release_id":      node.ActiveReleaseID,
		"ruleset":                node.Ruleset,
		"sync":                   node.SyncStatus,
		"lastHeartbeat":          node.LastHeartbeat,
		"lastHeartbeatTimestamp": node.LastHeartbeatTimestamp,
		"created_at":             node.CreatedAt,
		"joinMethod":             node.JoinMethod,
		"certificate":            node.Certificate,
		"policySync":             node.PolicySync,
		"lastSyncTime":           node.LastSyncTime,
		"cpuUsage":               node.CPUUsage,
		"memoryUsage":            node.MemoryUsage,
		"activeConnections":      node.ActiveConnections,
		"requestsPerSecond":      node.RequestsPerSecond,
		"uptime":                 node.Uptime,
		"runtimeStartedAt":       node.RuntimeStartedAt,
		"metricsScope":           node.MetricsScope,
		"metricsAvailable":       node.MetricsAvailable,
	})
}

// Heartbeat tiếp nhận gói tin Push Heartbeat Telemetry (bắt buộc 100% Protobuf binary wire format).
func (h *NodeHandler) Heartbeat(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	// Bắt buộc 100% định dạng application/x-protobuf, loại bỏ hoàn toàn fallback JSON
	contentType := c.GetHeader("Content-Type")
	if contentType != "application/x-protobuf" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"error": "unsupported media type: application/x-protobuf required",
		})
		return
	}

	// Đọc dữ liệu nhị phân (giới hạn tối đa 4KB)
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unable to read binary payload or payload exceeds 4KB"})
		return
	}

	payload, err := entity.UnmarshalNodeHeartbeat(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to unmarshal Protobuf binary: " + err.Error()})
		return
	}

	// Đảm bảo node_id trong path khớp với payload
	if payload.NodeID == "" {
		payload.NodeID = nodeID
	} else if payload.NodeID != nodeID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID in path does not match payload"})
		return
	}

	payload.IP = c.ClientIP()
	payload.Authentication = "Bearer / HTTP"
	if c.Request.TLS != nil {
		payload.Authentication = "Bearer / TLS"
		if len(c.Request.TLS.VerifiedChains) > 0 {
			payload.Authentication = "mTLS verified"
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeHeartbeatTimeout)
	defer cancel()

	directive, err := h.service.RecordHeartbeat(ctx, *payload)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "heartbeat processing timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record heartbeat: " + err.Error()})
		return
	}

	// Trả về HTTP 200 OK kèm chỉ thị lệnh (Directive) cho Data Plane Node
	c.JSON(http.StatusOK, gin.H{
		"action":             directive.Action,
		"desired_release_id": directive.DesiredReleaseID,
	})
}

// ReloadNode tiếp nhận yêu cầu POST /api/v1/nodes/:id/reload để kích hoạt reload một node cụ thể.
func (h *NodeHandler) ReloadNode(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeReloadTimeout)
	defer cancel()

	if err := h.service.TriggerNodeReload(ctx, nodeID); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "node reload timed out"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Reload command dispatched to node " + nodeID + ". It will be executed on next heartbeat.",
		"status":  "pending",
	})
}

// RollingReloadCluster tiếp nhận yêu cầu POST /api/v1/nodes/rolling-reload để khởi động rolling reload tuần tự cả cụm.
func (h *NodeHandler) RollingReloadCluster(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeReloadTimeout)
	defer cancel()

	status, err := h.service.TriggerClusterRollingReload(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "cluster rolling reload timed out"})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ClusterRollingStatusResponse{
		Active:         status.Active,
		CurrentNodeID:  status.CurrentNodeID,
		PendingNodes:   status.PendingNodes,
		CompletedNodes: status.CompletedNodes,
		Message:        status.Message,
	})
}

// GetRollingStatus tiếp nhận yêu cầu GET /api/v1/nodes/rolling-status để kiểm tra tiến trình rolling cluster.
func (h *NodeHandler) GetRollingStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	status, err := h.service.GetClusterRollingStatus(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get rolling reload status timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ClusterRollingStatusResponse{
		Active:         status.Active,
		CurrentNodeID:  status.CurrentNodeID,
		PendingNodes:   status.PendingNodes,
		CompletedNodes: status.CompletedNodes,
		Message:        status.Message,
	})
}

// EventsStream mở luồng HTTP Server-Sent Events (SSE) để truyền dữ liệu thời gian thực tới UI.
// Endpoint này duy trì kết nối stream liên tục cho đến khi client ngắt kết nối (không đặt timeout cứng).
func (h *NodeHandler) EventsStream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	eventChan, unsubscribe := h.service.SubscribeEvents()
	defer unsubscribe()

	// Gửi một gói tin ping ban đầu để xác lập kết nối
	c.SSEvent("ping", gin.H{"status": "connected"})
	c.Writer.Flush()

	// Ticker ping định kỳ 15s giữ luồng SSE luôn thông suốt qua mọi proxy
	keepAliveTicker := time.NewTicker(15 * time.Second)
	defer keepAliveTicker.Stop()

	clientDone := c.Request.Context().Done()

	for {
		select {
		case <-clientDone:
			// Client đóng tab, chuyển trang, hoặc ngắt mạng
			return
		case <-keepAliveTicker.C:
			c.SSEvent("ping", gin.H{"status": "keepalive"})
			c.Writer.Flush()
		case msg, ok := <-eventChan:
			if !ok {
				return
			}
			data := msg.Data
			if beats, ok := msg.Data.([]entity.NodeHeartbeatEvent); ok {
				resp := make([]dto.NodeHeartbeatEventResponse, len(beats))
				for i, b := range beats {
					resp[i] = dto.NodeHeartbeatEventResponse{
						MetricsScope:     b.MetricsScope,
						RuntimeStartedAt: b.RuntimeStartedAt,
						MetricsAvailable: b.MetricsAvailable,
						NodeID:           b.NodeID,
						IP:               b.IP,
						Status:           b.Status,
						RPS:              b.RPS,
						ActiveConns:      b.ActiveConns,
						CPUUsage:         b.CPUUsage,
						MemoryUsage:      b.MemoryUsage,
						Sync:             b.Sync,
						Ruleset:          b.Ruleset,
						Timestamp:        b.Timestamp,
					}
				}
				data = resp
			}
			c.SSEvent(msg.Event, data)
			c.Writer.Flush()
		}
	}
}

// GetSyncLogs xử lý HTTP GET /api/v1/nodes/:id/sync-history:
// Trả về danh sách các bản ghi lịch sử đồng bộ thực tế của node.
func (h *NodeHandler) GetSyncLogs(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	logs, err := h.service.ListNodeSyncLogs(ctx, nodeID, 30)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "sync history query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query sync history: " + err.Error()})
		return
	}

	resp := make([]dto.NodeSyncLogResponse, len(logs))
	for i, l := range logs {
		resp[i] = dto.NodeSyncLogResponse{
			ID:        l.ID,
			NodeID:    l.NodeID,
			EventType: l.EventType,
			ReleaseID: l.ReleaseID,
			Message:   l.Message,
			CreatedAt: l.CreatedAt,
		}
	}
	c.JSON(http.StatusOK, resp)
}

// GetConfig xử lý HTTP GET /api/v1/nodes/:id/config:
// Kéo trực tiếp nội dung file cấu hình NGINX (/etc/nginx/nginx.conf) từ node container.
func (h *NodeHandler) GetConfig(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	config, err := h.service.GetNodeConfig(ctx, nodeID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get node config timed out"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"node_id":    nodeID,
		"path":       "/etc/nginx/nginx.conf",
		"config":     config,
		"fetched_at": time.Now().UTC().Format(time.RFC3339),
	})
}
