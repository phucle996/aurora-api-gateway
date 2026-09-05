package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"net/http"

	"github.com/gin-gonic/gin"
)

// formatNodeResponse chuyển đổi tường minh từ domain entity sang gin.H (JSON contract).
// Việc map tường minh từng trường đảm bảo:
// 1. Nhìn thấy trực tiếp và chính xác JSON schema trả về cho client mà không bị ẩn trong struct tags.
// 2. Tránh hiện tượng drift schema khi struct entity nội bộ thay đổi.
func formatNodeResponse(node *entity.ClusterNodeRecord) gin.H {
	return gin.H{
		"id":                node.ID,
		"name":              node.Name,
		"hostname":          node.Hostname,
		"ip":                node.IP,
		"role":              node.Role,
		"status":            node.Status,
		"version":           node.Version,
		"active_release_id": node.ActiveReleaseID,
		"ruleset":           node.Ruleset,
		"sync":              node.SyncStatus,
		"lastHeartbeat":     node.LastHeartbeat,
		"created_at":        node.CreatedAt,
		"joinMethod":        node.JoinMethod,
		"certificate":       node.Certificate,
		"policySync":        node.PolicySync,
		"lastSyncTime":      node.LastSyncTime,
		"cpuUsage":          node.CPUUsage,
		"memoryUsage":       node.MemoryUsage,
		"activeConnections": node.ActiveConnections,
		"requestsPerSecond": node.RequestsPerSecond,
		"uptime":            node.Uptime,
	}
}

// ListNodes xử lý HTTP GET /api/v1/nodes:
// Trả về danh sách tất cả các NGINX Data Plane nodes đã đăng ký trong cluster.
func ListNodes(s port.NodeService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Tiếp nhận context từ HTTP request
		ctx := c.Request.Context()

		// Bước 2: Gọi service để lấy danh sách nodes cùng trạng thái runtime
		nodes, err := s.ListNodes(ctx)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn danh sách nodes: " + err.Error()})
			return
		}

		// Bước 3: Map tường minh từng entity sang gin.H để cố định schema JSON
		response := make([]gin.H, 0, len(nodes))
		for i := range nodes {
			response = append(response, formatNodeResponse(&nodes[i]))
		}

		// Bước 4: Trả về kết quả HTTP 200 OK định dạng JSON
		c.JSON(http.StatusOK, response)
	}
}

// GetNodeByID xử lý HTTP GET /api/v1/nodes/:id:
// Trả về chi tiết của một node cụ thể trong cluster.
func GetNodeByID(s port.NodeService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Lấy và thẩm định tham số ID từ URL path
		id := c.Param("id")
		if id == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Mã định danh node không được để trống"})
			return
		}

		// Bước 2: Gọi service lấy thông tin chi tiết
		ctx := c.Request.Context()
		node, err := s.GetNodeByID(ctx, id)
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
		c.JSON(http.StatusOK, formatNodeResponse(node))
	}
}
