package app

import (
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
	r.POST("/api/v1/auth/login", loginLimiter.Handler(), m.AuthHandler.Login)                     // Đăng nhập, trả về JWT
	r.POST("/api/v1/auth/2fa/login-verify", loginLimiter.Handler(), m.AuthHandler.Verify2FALogin) // Xác thực 2FA OTP bước 2
	r.POST("/api/v1/auth/logout", m.AuthHandler.Logout)                                           // Xoá cookie JWT

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

	// Unified Spec Sync
	r.GET("/api/v1/sync/spec", authMidd, m.SpecHandler.GetSpec)
	r.GET("/api/v1/sync/spec/:node", authMidd, m.SpecHandler.GetSpec)

	// Extension Management API
	r.GET("/api/v1/extensions", authMidd, m.ExtensionHandler.List)
	r.GET("/api/v1/extensions/:id", authMidd, m.ExtensionHandler.GetByID)
	r.PUT("/api/v1/extensions/:id/status", authMidd, m.ExtensionHandler.UpdateStatus)
	r.PUT("/api/v1/extensions/:id/config", authMidd, m.ExtensionHandler.UpdateConfig)
	r.PUT("/api/v1/extensions/:id/schema", authMidd, m.ExtensionHandler.UpdateSchema)

	// Route protected — phải vượt qua authMidd
	r.GET("/api/v1/auth/me", authMidd, m.AuthHandler.Me)         // Thông tin user hiện tại
	r.GET("/api/v1/system/info", authMidd, m.SystemHandler.Info) // Thông tin runtime hệ thống thực tế

	// Quản lý Routing API
	r.GET("/api/v1/routes", authMidd, m.RouteHandler.List)
	r.POST("/api/v1/routes", authMidd, m.RouteHandler.Create)
	r.GET("/api/v1/routes/:id", authMidd, m.RouteHandler.GetByID)
	r.PUT("/api/v1/routes/:id", authMidd, m.RouteHandler.Update)
	r.DELETE("/api/v1/routes/:id", authMidd, m.RouteHandler.Delete)
	r.PUT("/api/v1/routes/:id/status", authMidd, m.RouteHandler.ToggleStatus)

	// Quản lý Certificates API
	r.GET("/api/v1/certificates", authMidd, m.CertificateHandler.List)
	r.POST("/api/v1/certificates", authMidd, m.CertificateHandler.Create)
	r.GET("/api/v1/certificates/:id", authMidd, m.CertificateHandler.GetByID)
	r.PUT("/api/v1/certificates/:id", authMidd, m.CertificateHandler.Update)
	r.DELETE("/api/v1/certificates/:id", authMidd, m.CertificateHandler.Delete)

	// Quản lý Upstream API & Node Sync
	r.POST("/api/v1/upstreams", authMidd, m.UpstreamHandler.Create)           // Tạo mới upstream pool
	r.PUT("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.Update)        // Cập nhật upstream pool
	r.GET("/api/v1/upstreams", authMidd, m.UpstreamHandler.List)              // Danh sách upstream pools
	r.GET("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.GetByID)       // Chi tiết upstream
	r.DELETE("/api/v1/upstreams/:id", authMidd, m.UpstreamHandler.Delete)     // Xóa upstream pool
	r.GET("/api/v1/upstream-sync/:node", authMidd, m.UpstreamHandler.Desired) // Đồng bộ cấu hình upstream tới NGINX Data Plane
	r.POST("/api/v1/upstream-sync/:node", authMidd, m.UpstreamHandler.Report) // Node báo cáo kết quả đồng bộ upstream

	// Quản lý Cluster Nodes (danh sách và trạng thái các NGINX data plane nodes)
	r.GET("/api/v1/events/stream", authMidd, m.NodeHandler.EventsStream)            // Server-Sent Events (SSE) realtime metrics & liveness stream
	r.GET("/api/v1/nodes", authMidd, m.NodeHandler.List)                            // Danh sách nodes trong cluster
	r.GET("/api/v1/nodes/rolling-status", authMidd, m.NodeHandler.GetRollingStatus) // Trạng thái tiến trình rolling reload
	r.POST("/api/v1/nodes/rolling-reload", authMidd, m.NodeHandler.RollingReload)   // Kích hoạt rolling reload tuần tự
	r.GET("/api/v1/nodes/:id", authMidd, m.NodeHandler.GetByID)                     // Chi tiết 1 node
	r.DELETE("/api/v1/nodes/:id", authMidd, m.NodeHandler.Delete)                   // Xóa / deregister node khỏi cluster
	r.GET("/api/v1/nodes/:id/config", authMidd, m.NodeHandler.GetConfig)            // Kéo file cấu hình thực tế từ container node
	r.POST("/api/v1/nodes/:id/reload", authMidd, m.NodeHandler.ReloadNode)          // Đặt lệnh reload cho 1 node
	r.POST("/api/v1/nodes/:id/heartbeat", authMidd, m.NodeHandler.Heartbeat)        // Heartbeat telemetry đẩy từ Node (Protobuf binary)
	r.GET("/api/v1/nodes/:id/sync-history", authMidd, m.NodeHandler.GetSyncLogs)    // Lịch sử đồng bộ thực tế của node

	// Phân tích số liệu chuyên sâu & Analytics Explorer (Grafana Inline)
	r.POST("/api/v1/analytics/query", authMidd, m.AnalyticsHandler.Query)
	r.POST("/api/v1/analytics/query-raw", authMidd, m.AnalyticsHandler.QueryRaw)
	r.GET("/api/v1/analytics/catalog", authMidd, m.AnalyticsHandler.GetCatalog)
	r.GET("/api/v1/analytics/connection", authMidd, m.AnalyticsHandler.GetConnection)
	r.PUT("/api/v1/analytics/connection", authMidd, m.AnalyticsHandler.UpdateConnection)
	r.POST("/api/v1/analytics/connection/test", authMidd, m.AnalyticsHandler.TestConnection)

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
