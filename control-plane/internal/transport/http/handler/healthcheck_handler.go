package handler

import (
	"context"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

// HealthcheckHandler cung cấp các HTTP endpoint kiểm tra sức khỏe của Control Plane phục vụ Kubernetes probes, Docker healthchecks và load balancers.
type HealthcheckHandler struct{ service service.HealthcheckService }

// NewHealthcheckHandler khởi tạo handler cho HealthcheckService.
func NewHealthcheckHandler(service service.HealthcheckService) *HealthcheckHandler {
	return &HealthcheckHandler{service: service}
}

// Health xử lý HTTP GET /health: Liveness probe xác nhận tiến trình daemon control-plane đang hoạt động bình thường.
func (h *HealthcheckHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Status xử lý HTTP GET /status: Báo cáo trạng thái các thành phần nội bộ, giai đoạn khởi động (stage) và tính sẵn sàng thực thi WAF.
func (h *HealthcheckHandler) Status(c *gin.Context) {
	st := h.service.Status()
	c.JSON(http.StatusOK, gin.H{
		"component":         st.Component,
		"stage":             st.Stage,
		"enforcement_ready": st.EnforcementReady,
		"message":           st.Message,
	})
}

// Ready xử lý HTTP GET /ready: Readiness probe kiểm tra khả năng truy cập cơ sở dữ liệu lưu trữ SQLite với timeout 2 giây.
// Trả về HTTP 503 Service Unavailable nếu cơ sở dữ liệu bị khóa hoặc mất kết nối.
func (h *HealthcheckHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := h.service.Ready(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
