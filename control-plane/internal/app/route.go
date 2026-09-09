package app

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"time"

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

	// Rate limiter chống brute-force đăng nhập (tối đa 5 lần thử/phút cho mỗi client IP)
	loginLimiter := middleware.NewLoginRateLimiter(5, time.Minute)

	// Route auth public — gọi để lấy token rồi mới gọi các route protected
	r.POST("/api/v1/auth/login", loginLimiter.Handler(), m.AuthHandler.Login) // Đăng nhập, trả về JWT
	r.POST("/api/v1/auth/2fa/login-verify", loginLimiter.Handler(), m.AuthHandler.Verify2FALogin) // Xác thực 2FA OTP bước 2
	r.POST("/api/v1/auth/logout", m.AuthHandler.Logout)                       // Xoá cookie JWT

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
	r.GET("/api/v1/auth/me", authMidd, m.AuthHandler.Me)         // Thông tin user hiện tại
	r.GET("/api/v1/system/info", authMidd, m.SystemHandler.Info) // Thông tin runtime hệ thống thực tế

	// Module Store & Jobs
	r.GET("/api/v1/settings/modules", authMidd, m.ModuleStoreHandler.List)
	r.POST("/api/v1/settings/modules/:node/jobs", authMidd, m.ModuleStoreHandler.Queue)
	r.GET("/api/v1/settings/modules/jobs/:id/logs", authMidd, m.ModuleStoreHandler.GetJobLogs)

	// Backward compatibility aliases for settings
	r.GET("/api/v1/settings/dependencies", authMidd, m.ModuleStoreHandler.List)
	r.POST("/api/v1/settings/dependencies/:node/jobs", authMidd, m.ModuleStoreHandler.Queue)
	r.GET("/api/v1/settings/dependencies/jobs/:id/logs", authMidd, m.ModuleStoreHandler.GetJobLogs)

	// Both node endpoints require the operator header, never query/cookie authentication.
	registerNodeSync := func(pathPrefix string) {
		r.POST(pathPrefix+"/:node/poll", authMidd, func(c *gin.Context) {
			expected := sha256.Sum256([]byte("Bearer " + token))
			actual := sha256.Sum256([]byte(c.GetHeader("Authorization")))
			if token == "" || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
				c.AbortWithStatus(403)
				return
			}
			m.ModuleStoreHandler.Poll(c)
		})
		r.POST(pathPrefix+"/:node/report", authMidd, func(c *gin.Context) {
			expected := sha256.Sum256([]byte("Bearer " + token))
			actual := sha256.Sum256([]byte(c.GetHeader("Authorization")))
			if token == "" || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
				c.AbortWithStatus(403)
				return
			}
			m.ModuleStoreHandler.Report(c)
		})
	}
	registerNodeSync("/api/v1/module-sync")
	registerNodeSync("/api/v1/dependency-sync")

	// Quản lý Domain API
	r.GET("/api/v1/domain-routing/:node", authMidd, m.DomainRoutingHandler.Desired)
	r.GET("/api/v1/domain-routing/:node/bundle", authMidd, func(c *gin.Context) {
		expected := sha256.Sum256([]byte("Bearer " + token))
		actual := sha256.Sum256([]byte(c.GetHeader("Authorization")))
		if token == "" || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		m.DomainRoutingHandler.Bundle(c)
	})
	r.GET("/api/v1/domains", authMidd, m.DomainHandler.List)            // Danh sách domain (filter, phân trang, stats)
	r.GET("/api/v1/domains/catalog", authMidd, m.DomainHandler.Catalog) // Danh mục domain phục vụ target scope & dropdown
	r.POST("/api/v1/domains", authMidd, m.DomainHandler.Create)         // Tạo mới domain
	r.GET("/api/v1/domains/:id", authMidd, m.DomainHandler.GetByID)     // Lấy chi tiết domain
	r.PUT("/api/v1/domains/:id", authMidd, m.DomainHandler.Update)      // Cập nhật domain
	r.DELETE("/api/v1/domains/:id", authMidd, m.DomainHandler.Delete)   // Xoá domain

	// Quản lý Upstream API & Node Sync
	r.POST("/api/v1/upstreams", authMidd, m.UpstreamHandler.Create)           // Tạo mới upstream pool
	r.PUT("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.Update)        // Cập nhật upstream pool
	r.GET("/api/v1/upstreams", authMidd, m.UpstreamHandler.List)              // Danh sách upstream pools
	r.GET("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.GetByID)       // Chi tiết upstream
	r.DELETE("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.Delete)     // Xóa upstream pool
	r.GET("/api/v1/upstream-sync/:node", authMidd, m.UpstreamHandler.Desired) // Đồng bộ cấu hình upstream tới NGINX Data Plane
	r.POST("/api/v1/upstream-sync/:node", authMidd, m.UpstreamHandler.Report) // Node báo cáo kết quả đồng bộ upstream

	// Quản lý Rate Limit Rules API
	r.POST("/api/v1/rate-limits", authMidd, m.RateLimitHandler.Create)                   // Tạo mới Rate Limit Rule
	r.GET("/api/v1/rate-limits", authMidd, m.RateLimitHandler.List)                      // Danh sách Rate Limit Rules
	r.GET("/api/v1/rate-limits/stats", authMidd, m.RateLimitHandler.GetStats)            // Thống kê tổng hợp số liệu thực tế
	r.GET("/api/v1/rate-limits/metrics", authMidd, m.RateLimitHandler.GetMetrics)        // Biểu đồ vận tốc & top endpoints
	r.GET("/api/v1/rate-limits/:id", authMidd, m.RateLimitHandler.GetByID)               // Chi tiết Rate Limit Rule
	r.PUT("/api/v1/rate-limits/:id", authMidd, m.RateLimitHandler.Update)                // Cập nhật Rate Limit Rule
	r.DELETE("/api/v1/rate-limits/:id", authMidd, m.RateLimitHandler.Delete)             // Xóa Rate Limit Rule
	r.POST("/api/v1/rate-limits/flush", authMidd, m.RateLimitHandler.Flush)              // Flush metrics chủ động
	r.POST("/api/v1/rate-limits/enable", authMidd, m.RateLimitHandler.EnableCollector)   // Bật thu thập metrics
	r.POST("/api/v1/rate-limits/disable", authMidd, m.RateLimitHandler.DisableCollector) // Tắt thu thập metrics

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
	r.GET("/api/v1/rules/:id/history", authMidd, m.RuleHandler.History)    // Lịch sử thay đổi
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

	// Cấu hình Bảo mật, 2FA & Đổi mật khẩu (Security Settings)
	r.GET("/api/v1/settings/security", authMidd, m.SecurityHandler.GetOverview)
	r.PUT("/api/v1/settings/security/auth-providers/:id", authMidd, m.SecurityHandler.UpdateProvider)
	r.POST("/api/v1/settings/security/2fa/init", authMidd, m.SecurityHandler.Init2FA)
	r.POST("/api/v1/settings/security/2fa/verify", authMidd, m.SecurityHandler.Verify2FA)
	r.POST("/api/v1/settings/security/2fa/disable", authMidd, m.SecurityHandler.Disable2FA)
	r.POST("/api/v1/settings/security/change-password", authMidd, m.SecurityHandler.ChangePassword)

	// Cấu hình Thông báo Đa Kênh & Quy tắc Cảnh báo (Notification Channels & Alert Rules)
	r.GET("/api/v1/settings/notifications", authMidd, m.NotificationHandler.GetOverview)
	r.PUT("/api/v1/settings/notifications/channels/:id", authMidd, m.NotificationHandler.UpdateChannel)
	r.PUT("/api/v1/settings/notifications/rules/:id", authMidd, m.NotificationHandler.UpdateRule)
	r.POST("/api/v1/settings/notifications/channels/:id/test", authMidd, m.NotificationHandler.TestChannel)

	// Sao lưu & Phục hồi dữ liệu (Backup & Restore, S3 Storage, Cron Job & Drag-and-Drop)
	r.GET("/api/v1/settings/backup", authMidd, m.BackupHandler.GetOverview)
	r.PUT("/api/v1/settings/backup/config", authMidd, m.BackupHandler.UpdateConfig)
	r.GET("/api/v1/settings/backup/download", authMidd, m.BackupHandler.DownloadLocalBackup)
	r.POST("/api/v1/settings/backup/s3/upload", authMidd, m.BackupHandler.TriggerS3Backup)
	r.POST("/api/v1/settings/backup/restore", authMidd, m.BackupHandler.RestoreSnapshot)
}
