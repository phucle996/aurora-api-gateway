package app

import (
	"aurora-waf.local/control-plane/internal/transport/http/middleware"

	"github.com/gin-gonic/gin"
)

// RegisterRoutes gắn toàn bộ đường API vào router.
// Đây là hàm duy nhất quản lý route — không có route nào ở nơi khác.
//
// Phân loại route:
//   - Public  : bất kỳ ai cũng gọi được, không cần đăng nhập
//   - Protected: phải đi kèm token hợp lệ (JWT cookie hoặc Authorization header)
//
// token là Bearer token tĩnh (admin token từ file). Nếu rỗng thì
// chỉ chấp nhận JWT đăng nhập bình thường.
func RegisterRoutes(r *gin.Engine, m *Module, token string) {
	// Route public — không yêu cầu đăng nhập
	r.GET("/healthz", m.HealthcheckHandler.Health)       // Load balancer ping — luôn OK
	r.GET("/readyz", m.HealthcheckHandler.Ready)         // Kiểm tra DB sẵn sàng
	r.GET("/api/v1/status", m.HealthcheckHandler.Status) // Thông tin phiên bản & trạng thái

	// Route auth public — gọi để lấy token rồi mới gọi các route protected
	r.POST("/api/v1/auth/login", m.AuthHandler.Login)   // Đăng nhập, trả về JWT
	r.POST("/api/v1/auth/logout", m.AuthHandler.Logout) // Xoá cookie JWT

	// authMidd kiểm tra JWT từ cả cookie HttpOnly lẫn Authorization header.
	// Nếu thiếu hoặc sai token, middleware trả về 401 và dừng request luôn.
	authMidd := middleware.Auth(m.AuthService, token)

	r.GET("/api/v1/access", authMidd, m.AccessHandler.Read)
	r.GET("/api/v1/access/status", authMidd, m.AccessHandler.Status)
	r.GET("/api/v1/access/activity", authMidd, m.AccessHandler.Activity)
	r.GET("/api/v1/access/catalog", authMidd, m.AccessHandler.Catalog)
	r.POST("/api/v1/access/changes", authMidd, m.AccessHandler.Change)
	r.GET("/api/v1/access-sync/:node", authMidd, m.AccessHandler.Desired)
	r.POST("/api/v1/access-sync/:node", authMidd, m.AccessHandler.Report)
	r.POST("/api/v1/access-sync/:node/matches", authMidd, m.AccessHandler.Match)

	r.GET("/api/v1/policies", authMidd, m.PolicyHandler.List)
	r.GET("/api/v1/policies/catalog", authMidd, m.PolicyHandler.Catalog)
	r.GET("/api/v1/policies/rule-catalog", authMidd, m.PolicyHandler.RuleCatalog)
	r.GET("/api/v1/policies/cluster", authMidd, m.PolicyHandler.Cluster)
	r.GET("/api/v1/policies/:id", authMidd, m.PolicyHandler.List)
	r.POST("/api/v1/policies", authMidd, m.PolicyHandler.SaveDraft)
	r.PUT("/api/v1/policies/:id", authMidd, m.PolicyHandler.SaveDraft)
	r.POST("/api/v1/policies/:id/publish", authMidd, m.PolicyHandler.PublishDraft)
	r.GET("/api/v1/policy-sync/:node", authMidd, m.PolicyHandler.Desired)
	r.POST("/api/v1/policy-sync/:node", authMidd, m.PolicyHandler.Report)

	// Route protected — phải vượt qua authMidd
	r.GET("/api/v1/auth/me", authMidd, m.AuthHandler.Me) // Thông tin user hiện tại

	// Quản lý Rule API v2 (schema mới, hỗ trợ điều kiện phức tạp)
	r.POST("/api/v2/rules", authMidd, m.RuleHandler.CreateDefinition)
	r.PUT("/api/v2/rules/:id", authMidd, m.RuleHandler.UpdateDefinition)
	r.DELETE("/api/v1/rules/:id", authMidd, m.RuleHandler.Delete)

	// Quản lý Rule API v1
	r.GET("/api/v1/rules", authMidd, m.RuleHandler.List)                   // Danh sách rule (có filter, phân trang)
	r.POST("/api/v1/rules", authMidd, m.RuleHandler.Create)                // Tạo rule mới
	r.GET("/api/v1/rules/stats", authMidd, m.RuleHandler.Stats)            // Thống kê số lượng rule
	r.GET("/api/v1/rules/:id", authMidd, m.RuleHandler.Detail)             // Chi tiết 1 rule
	r.PUT("/api/v1/rules/:id", authMidd, m.RuleHandler.Update)             // Cập nhật rule
	r.GET("/api/v1/rules/:id/history", authMidd, m.RuleHandler.History)      // Lịch sử thay đổi
	r.POST("/api/v1/rules/:id/rollback", authMidd, m.RuleHandler.Rollback) // Khôi phục cấu hình về phiên bản cũ
	r.POST("/api/v1/rules/test", authMidd, m.RuleHandler.Test)             // Kiểm thử & đánh giá request với tập luật WAF
	r.POST("/api/v1/rules/:id/test", authMidd, m.RuleHandler.Test)         // Kiểm thử theo ID rule cụ thể

	// Phát hành (publish) bộ rule để NGINX áp dụng
	r.POST("/api/v1/rule-releases", authMidd, m.RuleHandler.Publish)          // Tạo release mới
	r.GET("/api/v1/rule-releases/:id", authMidd, m.RuleHandler.ReleaseDetail) // Trạng thái release

	// Quản lý Cluster Nodes (danh sách và trạng thái các NGINX data plane nodes)
	r.GET("/api/v1/events/stream", authMidd, m.NodeHandler.EventsStream)                 // Server-Sent Events (SSE) realtime metrics & liveness stream
	r.GET("/api/v1/nodes", authMidd, m.NodeHandler.List)                                 // Danh sách nodes trong cluster
	r.GET("/api/v1/nodes/rolling-status", authMidd, m.NodeHandler.GetRollingStatus)      // Trạng thái tiến trình rolling reload
	r.POST("/api/v1/nodes/rolling-reload", authMidd, m.NodeHandler.RollingReloadCluster) // Kích hoạt rolling reload toàn cụm
	r.GET("/api/v1/nodes/:id", authMidd, m.NodeHandler.GetByID)                          // Chi tiết 1 node
	r.GET("/api/v1/nodes/:id/config", authMidd, m.NodeHandler.GetConfig)                 // Kéo file cấu hình thực tế từ container node
	r.POST("/api/v1/nodes/:id/reload", authMidd, m.NodeHandler.ReloadNode)               // Đặt lệnh reload cho 1 node
	r.POST("/api/v1/nodes/:id/heartbeat", authMidd, m.NodeHandler.Heartbeat)             // Heartbeat telemetry đẩy từ Node (Protobuf binary)
	r.GET("/api/v1/nodes/:id/metrics", authMidd, m.MetricsHandler.GetNodeMetrics)        // Timeline metrics của node
	r.GET("/api/v1/nodes/:id/sync-history", authMidd, m.NodeHandler.GetSyncLogs)         // Lịch sử đồng bộ thực tế của node

	// Cấu hình tích hợp hệ thống (System Settings & Telemetry Integrations)
	r.GET("/api/v1/settings/integrations/metrics", authMidd, m.MetricsHandler.GetConfig)            // Lấy cấu hình Telemetry hiện tại
	r.PUT("/api/v1/settings/integrations/metrics", authMidd, m.MetricsHandler.UpdateConfig)         // Chuyển đổi giữa Lab/Standalone và Production
	r.POST("/api/v1/settings/integrations/metrics/test", authMidd, m.MetricsHandler.TestConnection) // Kiểm tra kết nối tới Prometheus
}
