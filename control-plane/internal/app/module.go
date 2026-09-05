package app

import (
	"aurora-waf.local/control-plane/internal/config"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
	"database/sql"
)

// Module là "thùng chứa" tập hợp tất cả handler HTTP của ứng dụng.
// Nó được khởi tạo một lần duy nhất khi ứng dụng khởi động,
// sau đó RegisterRoutes gắn các handler vào đúng URL tương ứng.
type Module struct {
	StatusHandler  *handler.StatusHandler
	AuthHandler    *handler.AuthHandler
	AuthService    port.AuthService // Xác thực JWT — cần tham chiếu trong middleware
	RuleHandler    *handler.RuleHandler
	NodeHandler    *handler.NodeHandler
	MetricsHandler *handler.MetricsHandler
}

// NewModule khởi tạo toàn bộ chuỗi dependency của ứng dụng theo thứ tự:
//   1. Repository (sử dụng đúng writerDB hoặc readerDB tùy loại workflow)
//   2. Service    (nhận repository và chứa logic nghiệp vụ)
//   3. Handler    (bao đóng service thành Handler struct)
//
// writerDB dùng cho các mutation (tạo/sửa/publish rule).
// readerDB dùng cho các query (list/detail/stats/history).
// cfg cung cấp JWT secret, đường dẫn compiler và các thiết lập khác.
func NewModule(writerDB, readerDB *sql.DB, cfg config.Config) *Module {
	storageRepo := repository.NewStorageRepository(readerDB)
	statusSvc := service.NewStatusService(storageRepo)
	statusHdr := handler.NewStatusHandler(statusSvc)

	authRepo := repository.NewAuthRepository(readerDB)
	authSvc := service.NewAuthService(authRepo, cfg)
	authHdr := handler.NewAuthHandler(authSvc)

	ruleRepo := repository.NewRuleRepository(writerDB, readerDB)
	ruleSvc := service.NewRuleService(ruleRepo, cfg.CompilerPath)
	ruleHdr := handler.NewRuleHandler(ruleSvc)

	nodeRepo := repository.NewNodeRepository(readerDB)
	nodeSvc := service.NewNodeService(nodeRepo)
	nodeHdr := handler.NewNodeHandler(nodeSvc)

	settingsRepo := repository.NewSettingsRepository(writerDB)
	metricsSvc := service.NewMetricsService(settingsRepo)
	metricsHdr := handler.NewMetricsHandler(metricsSvc)

	return &Module{
		StatusHandler:  statusHdr,
		AuthHandler:    authHdr,
		AuthService:    authSvc,
		RuleHandler:    ruleHdr,
		NodeHandler:    nodeHdr,
		MetricsHandler: metricsHdr,
	}
}
