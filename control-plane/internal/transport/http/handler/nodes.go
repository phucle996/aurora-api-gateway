package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
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
	// Bước 1: Tiếp nhận context từ HTTP request
	ctx := c.Request.Context()

	// Bước 2: Gọi service để lấy danh sách nodes cùng trạng thái runtime
	nodes, err := h.service.ListNodes(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn danh sách nodes: " + err.Error()})
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
			"role":                   node.Role,
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã định danh node không được để trống"})
		return
	}

	// Bước 2: Gọi service lấy thông tin chi tiết
	ctx := c.Request.Context()
	node, err := h.service.GetNodeByID(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn node: " + err.Error()})
		return
	}

	// Bước 3: Kiểm tra sự tồn tại của node
	if node == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Không tìm thấy node"})
		return
	}

	// Bước 4: Map tường minh sang gin.H và trả về HTTP 200 OK
	c.JSON(http.StatusOK, gin.H{
		"id":                     node.ID,
		"name":                   node.Name,
		"hostname":               node.Hostname,
		"ip":                     node.IP,
		"role":                   node.Role,
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
	})
}

// Heartbeat tiếp nhận gói tin Push Heartbeat Telemetry (bắt buộc 100% Protobuf binary wire format).
func (h *NodeHandler) Heartbeat(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã node không được để trống"})
		return
	}

	// Bắt buộc 100% định dạng application/x-protobuf, loại bỏ hoàn toàn fallback JSON
	contentType := c.GetHeader("Content-Type")
	if contentType != "application/x-protobuf" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"error": "Định dạng không được hỗ trợ: bắt buộc application/x-protobuf",
		})
		return
	}

	// Đọc dữ liệu nhị phân (giới hạn tối đa 4KB)
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Không thể đọc dữ liệu binary hoặc payload vượt quá 4KB"})
		return
	}

	payload, err := entity.UnmarshalNodeHeartbeat(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Giải mã Protobuf binary thất bại: " + err.Error()})
		return
	}

	// Đảm bảo node_id trong path khớp với payload
	if payload.NodeID == "" {
		payload.NodeID = nodeID
	} else if payload.NodeID != nodeID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã node trong đường dẫn không khớp với dữ liệu gói tin"})
		return
	}

	payload.IP = c.ClientIP()

	ctx := c.Request.Context()
	directive, err := h.service.RecordHeartbeat(ctx, *payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ghi nhận heartbeat thất bại: " + err.Error()})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã node không được để trống"})
		return
	}

	ctx := c.Request.Context()
	if err := h.service.TriggerNodeReload(ctx, nodeID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Đã gửi lệnh reload tới node " + nodeID + ". Lệnh sẽ được thực thi tại chu kỳ heartbeat tiếp theo.",
		"status":  "pending",
	})
}

// RollingReloadCluster tiếp nhận yêu cầu POST /api/v1/nodes/rolling-reload để khởi động rolling reload tuần tự cả cụm.
func (h *NodeHandler) RollingReloadCluster(c *gin.Context) {
	ctx := c.Request.Context()
	status, err := h.service.TriggerClusterRollingReload(ctx)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, status)
}

// GetRollingStatus tiếp nhận yêu cầu GET /api/v1/nodes/rolling-status để kiểm tra tiến trình rolling cluster.
func (h *NodeHandler) GetRollingStatus(c *gin.Context) {
	ctx := c.Request.Context()
	status, err := h.service.GetClusterRollingStatus(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, status)
}

// EventsStream mở luồng HTTP Server-Sent Events (SSE) để truyền dữ liệu thời gian thực tới UI.
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
			c.SSEvent(msg.Event, msg.Data)
			c.Writer.Flush()
		}
	}
}

// GetSyncLogs xử lý HTTP GET /api/v1/nodes/:id/sync-history:
// Trả về danh sách các bản ghi lịch sử đồng bộ thực tế của node.
func (h *NodeHandler) GetSyncLogs(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã định danh node không được để trống"})
		return
	}

	logs, err := h.service.ListNodeSyncLogs(c.Request.Context(), nodeID, 30)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn lịch sử sync: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}

// GetConfig xử lý HTTP GET /api/v1/nodes/:id/config:
// Kéo trực tiếp nội dung file cấu hình NGINX (/etc/nginx/nginx.conf) từ node container.
func (h *NodeHandler) GetConfig(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mã định danh node không được để trống"})
		return
	}

	config, err := h.service.GetNodeConfig(c.Request.Context(), nodeID)
	if err != nil {
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
