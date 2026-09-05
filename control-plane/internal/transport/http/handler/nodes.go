package handler

import (
	port "aurora-waf.local/control-plane/internal/domain/service"
	"net/http"

	"github.com/gin-gonic/gin"
)

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

		// Bước 3: Trả về kết quả HTTP 200 OK định dạng JSON
		c.JSON(http.StatusOK, nodes)
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

		// Bước 4: Trả về chi tiết node
		c.JSON(http.StatusOK, node)
	}
}
